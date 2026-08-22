import { Bindings, Monitor } from '../types';
import { renderAlertDetail, sendAlertToAllChannels } from './notifier';

export async function checkSites(env: Bindings) {
  console.log('Starting scheduled check...');
  const now = Date.now();
  const { results } = await env.DB.prepare(`
    SELECT id, name, url, method, request_headers, request_body, interval, status,
           retry_count, last_check, keyword, user_agent, check_info_status, paused,
           alert_silence_uptime, alert_error_rate, last_alert_uptime
    FROM monitors
  `).all<Monitor>();
  const tasks = results.map(async (monitor) => {
    if (monitor.paused === 1) return;
    if (isTimeToCheck(monitor, now)) await performCheck(monitor, env);
  });
  await Promise.all(tasks);
}

export function isTimeToCheck(monitor: Monitor, now: number): boolean {
  if (monitor.status === 'RETRYING') return true;
  const lastCheck = monitor.last_check ? new Date(monitor.last_check).getTime() : 0;
  const intervalMs = (monitor.interval || 300) * 1000;
  return now - lastCheck >= intervalMs;
}

export function isExpectedStatusCode(status: number, expectedConfig: string | null): boolean {
  if (!expectedConfig || !expectedConfig.trim()) {
    return status >= 200 && status < 300;
  }
  const parts = expectedConfig.split(',').map(p => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.includes('-')) {
      const [start, end] = part.split('-').map(Number);
      if (!isNaN(start) && !isNaN(end) && status >= start && status <= end) {
        return true;
      }
    } else {
      const num = Number(part);
      if (!isNaN(num) && status === num) {
        return true;
      }
    }
  }
  return false;
}

export async function performCheck(monitor: Monitor, env: Bindings) {
  const startTime = Date.now();
  let status = 200;
  let isFail = false;
  let reason = '';

  try {
    let headers: Record<string, string> = {
      'User-Agent': monitor.user_agent || 'Uptime-Monitor/1.0',
    };
    if (monitor.request_headers) {
      try {
        const customHeaders = JSON.parse(monitor.request_headers) as Record<string, string>;
        headers = { ...headers, ...customHeaders };
      } catch { /* ignore malformed headers */ }
    }

    const fetchOptions: RequestInit = {
      method: monitor.method || 'GET',
      headers,
      cf: { cacheTtl: 0, cacheEverything: false } as RequestInitCfProperties,
    };

    if (['POST', 'PUT', 'PATCH'].includes(monitor.method || 'GET') && monitor.request_body) {
      fetchOptions.body = monitor.request_body;
      if (!headers['Content-Type']) {
        (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(monitor.url, fetchOptions);
    status = response.status;

    if (!isExpectedStatusCode(status, monitor.expected_codes)) {
      isFail = true;
      reason = `HTTP ${status}`;
    } else {
      const lastInfoCheck = monitor.check_info_status ? new Date(monitor.check_info_status).getTime() : 0;
      if (Date.now() - lastInfoCheck > 86400000) {
        env.DB.prepare('UPDATE monitors SET check_info_status = ? WHERE id = ?')
          .bind(new Date().toISOString(), monitor.id).run()
          .then(() => updateDomainCertInfo(env, monitor)).catch(console.error);
      }

      if (monitor.keyword) {
        const text = await response.text();
        if (!text.includes(monitor.keyword)) {
          isFail = true;
          reason = `Keyword "${monitor.keyword}" not found`;
        }
      }
    }
  } catch (e: unknown) {
    isFail = true;
    status = 0;
    const errorMsg = e instanceof Error ? e.message : 'Unknown error';
    if (errorMsg.includes('handshake') || errorMsg.includes('certificate') || errorMsg.includes('SSL') || errorMsg.includes('TLS')) {
      reason = `SSL Error: ${errorMsg}`;
    } else if (errorMsg.includes('time') || errorMsg.includes('timeout')) {
      reason = 'Timeout';
    } else {
      reason = errorMsg || 'Network Error';
    }
  }

  const latency = Date.now() - startTime;

  await env.DB.prepare('INSERT INTO logs (monitor_id, status_code, latency, is_fail, reason) VALUES (?, ?, ?, ?, ?)')
    .bind(monitor.id, status, latency, isFail ? 1 : 0, reason || null).run();

  if (!isFail && monitor.alert_error_rate > 0) {
    await checkErrorRateAlert(env, monitor);
  }

  let newStatus: Monitor['status'] = monitor.status;
  let newRetryCount = monitor.retry_count;

  try {
    const { results: activeMaint } = await env.DB.prepare(
      "SELECT affected_monitors FROM incidents WHERE type = 'maintenance' AND status = 'active' AND datetime(scheduled_start) <= datetime('now') AND datetime(scheduled_end) >= datetime('now')"
    ).all<{ affected_monitors: string | null }>();
    if (activeMaint && activeMaint.length > 0) {
      const inMaintenance = activeMaint.some(m => {
        if (!m.affected_monitors) return false;
        return m.affected_monitors.split(',').map(s => s.trim()).includes(String(monitor.id));
      });
      if (inMaintenance) {
        await env.DB.prepare('UPDATE monitors SET last_check = ?, status = ?, retry_count = ? WHERE id = ?')
          .bind(new Date().toISOString(), newStatus, newRetryCount, monitor.id).run();
        return;
      }
    }
  } catch { /* ignore maintenance check errors */ }

  const silenceHoursUptime = monitor.alert_silence_uptime ?? 24;
  const lastAlertUptimeMs = monitor.last_alert_uptime ? new Date(monitor.last_alert_uptime).getTime() : 0;
  const silenced = silenceHoursUptime > 0 && (Date.now() - lastAlertUptimeMs) < silenceHoursUptime * 3_600_000;

  if (isFail) {
    if (monitor.status === 'UP') {
      newStatus = 'RETRYING';
      newRetryCount = 1;
    } else if (monitor.status === 'RETRYING') {
      if (newRetryCount < 3) {
        newRetryCount++;
      } else {
        newStatus = 'DOWN';
        if (!silenced) {
          const detail = await renderAlertDetail(env, 'alert_template_down', '错误原因: {reason}', {
            reason,
            status: String(status),
            latency: String(latency),
            type: 'DOWN',
          }, monitor);
          const sent = await sendAlertToAllChannels(env, monitor, 'DOWN', detail);
          if (sent) await env.DB.prepare('UPDATE monitors SET last_alert_uptime = ? WHERE id = ?')
            .bind(new Date().toISOString(), monitor.id).run();
        }
      }
    }
  } else {
    if (monitor.status === 'DOWN') {
      const detail = await renderAlertDetail(env, 'alert_template_up', '响应耗时: {latency}ms', {
        reason,
        status: String(status),
        latency: String(latency),
        type: 'UP',
      }, monitor);
      const sent = await sendAlertToAllChannels(env, monitor, 'UP', detail);
      if (sent) await env.DB.prepare('UPDATE monitors SET last_alert_uptime = ? WHERE id = ?')
        .bind(new Date().toISOString(), monitor.id).run();
    }
    newStatus = 'UP';
    newRetryCount = 0;
  }

  await env.DB.prepare('UPDATE monitors SET last_check = ?, status = ?, retry_count = ? WHERE id = ?')
    .bind(new Date().toISOString(), newStatus, newRetryCount, monitor.id).run();
}

export async function checkErrorRateAlert(env: Bindings, monitor: Monitor) {
  try {
    const since = new Date(Date.now() - 5 * 60_000).toISOString();
    const row = await env.DB.prepare(
      'SELECT COUNT(*) as total, SUM(is_fail) as fails FROM logs WHERE monitor_id = ? AND created_at >= ?'
    ).bind(monitor.id, since).first<{ total: number; fails: number }>();

    if (!row || row.total < 3) return;

    const errorRate = Math.round((row.fails / row.total) * 100);
    if (errorRate >= monitor.alert_error_rate) {
      const silenceHoursUptime = monitor.alert_silence_uptime ?? 24;
      const lastAlertMs = monitor.last_alert_uptime ? new Date(monitor.last_alert_uptime).getTime() : 0;
      if (silenceHoursUptime > 0 && (Date.now() - lastAlertMs) < silenceHoursUptime * 3_600_000) return;

      const detail = await renderAlertDetail(
        env,
        'alert_template_error_rate',
        '错误率告警：过去 5 分钟内错误率 {error_rate}%，超过阈值 {threshold}%',
        {
          error_rate: String(errorRate),
          threshold: String(monitor.alert_error_rate),
          type: 'DOWN',
        },
        monitor
      );
      const sent = await sendAlertToAllChannels(env, monitor, 'DOWN', detail);
      if (sent) await env.DB.prepare('UPDATE monitors SET last_alert_uptime = ? WHERE id = ?')
        .bind(new Date().toISOString(), monitor.id).run();
    }
  } catch (e) {
    console.error('Error rate check failed:', e);
  }
}

export async function updateDomainCertInfo(env: Bindings, monitor: Monitor) {
  console.log(`Updating info for ${monitor.url}`);
  try {
    const urlObj = new URL(monitor.url);
    const domain = urlObj.hostname;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(domain)) {
      console.log(`Skipping cert/domain check for IP address: ${domain}`);
      return;
    }

    let certExpiry: string | null = null;
    try {
      const browserUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      const fetchCerts = async (searchDomain: string): Promise<Record<string, unknown>[]> => {
        try {
          const res = await fetch(`https://crt.sh/?q=${searchDomain}&output=json`, { headers: { 'User-Agent': browserUA } });
          if (!res.ok) return [];
          try { return JSON.parse(await res.text()) as Record<string, unknown>[]; } catch { return []; }
        } catch { return []; }
      };

      let certs = await fetchCerts(domain);
      if (domain.split('.').length > 2) {
        const parts = domain.split('.');
        const rootDomain = parts.slice(parts.length - 2).join('.');
        
        const [rootCerts, wildcardCerts] = await Promise.all([
          fetchCerts(rootDomain),
          fetchCerts(`%25.${rootDomain}`)
        ]);
        
        certs = [...certs, ...rootCerts, ...wildcardCerts];
      }

      if (certs.length > 0) {
        const nowMs = Date.now();
        const parseExpiry = (s: string) => new Date(s.replace(' ', 'T')).getTime();
        const validCerts = certs.filter(c => { const exp = parseExpiry(c.not_after as string); return !isNaN(exp) && exp > nowMs; });
        const source = validCerts.length > 0 ? validCerts : certs;
        const sorted = source.sort((a, b) => parseExpiry(b.not_after as string) - parseExpiry(a.not_after as string));
        certExpiry = (sorted[0].not_after as string).replace(' ', 'T');
        console.log(`Found cert expiry for ${domain}: ${certExpiry}`);
      }
    } catch (e) { console.warn('Failed to fetch cert info:', e); }

    let domainExpiry: string | null = null;
    try {
      const rdapRes = await fetch(`https://rdap.org/domain/${domain}`);
      if (rdapRes.ok) {
        const rdapData = await rdapRes.json<{ events?: { eventAction: string; eventDate: string }[] }>();
        const expEvent = (rdapData.events || []).find(e => e.eventAction.includes('expiration'));
        if (expEvent) domainExpiry = expEvent.eventDate;
      }
    } catch (e) { console.warn('Failed to fetch RDAP info:', e); }

    if (certExpiry || domainExpiry) {
      await env.DB.prepare('UPDATE monitors SET cert_expiry = ?, domain_expiry = ? WHERE id = ?')
        .bind(certExpiry, domainExpiry, monitor.id).run();
      console.log(`Updated info for ${domain}: Cert=${certExpiry}, Domain=${domainExpiry}`);
    }
  } catch (e: unknown) { console.error('Error in updateDomainCertInfo:', e); }
}
