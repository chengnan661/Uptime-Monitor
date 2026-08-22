import { Hono } from 'hono';
import { Bindings, Monitor } from '../types';
import { sendAlertToAllChannels } from '../services/notifier';

const settings = new Hono<{ Bindings: Bindings }>();

settings.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
    const obj: Record<string, string> = {};
    (results || []).forEach(r => { obj[r.key] = r.value; });
    return c.json(obj);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

settings.put('/', async (c) => {
  try {
    const body = await c.req.json<Record<string, string>>();
    const allowed = [
      'site_title',
      'site_description',
      'site_logo_url',
      'alert_template_down',
      'alert_template_up',
      'alert_template_error_rate',
      'custom_footer',
    ];
    const now = new Date().toISOString();
    for (const key of allowed) {
      if (body[key] !== undefined) {
        await c.env.DB.prepare(
          'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
        ).bind(key, body[key], now).run();
      }
    }
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

export const system = new Hono<{ Bindings: Bindings }>();

system.get('/health', async (c) => {
  try {
    const [monitors, logs, channels, daily, lastLog] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as c FROM monitors').first<{ c: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) as c FROM logs').first<{ c: number }>(),
      c.env.DB.prepare('SELECT COUNT(*) as c FROM notification_channels WHERE enabled = 1').first<{ c: number }>(),
      c.env.DB.prepare('SELECT MAX(date) as d FROM daily_uptime').first<{ d: string | null }>(),
      c.env.DB.prepare('SELECT MAX(created_at) as t FROM logs').first<{ t: string | null }>(),
    ]);
    return c.json({
      ok: true,
      checked_at: new Date().toISOString(),
      monitors: monitors?.c ?? 0,
      logs: logs?.c ?? 0,
      enabled_channels: channels?.c ?? 0,
      latest_daily_uptime: daily?.d || null,
      latest_log_at: lastLog?.t || null,
    });
  } catch (e: unknown) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// Prometheus / OpenMetrics 开放格式暴露
system.get('/metrics', async (c) => {
  try {
    const { results: monitors } = await c.env.DB.prepare(
      'SELECT id, name, url, status, cert_expiry, paused FROM monitors ORDER BY id ASC'
    ).all<Pick<Monitor, 'id' | 'name' | 'url' | 'status' | 'cert_expiry' | 'paused'>>();

    const { results: latencies } = await c.env.DB.prepare(`
      SELECT monitor_id, latency FROM logs WHERE id IN (
        SELECT MAX(id) FROM logs GROUP BY monitor_id
      )
    `).all<{ monitor_id: number; latency: number }>();

    const latMap = new Map<number, number>();
    (latencies || []).forEach(l => latMap.set(l.monitor_id, l.latency));

    const lines: string[] = [
      '# HELP uptime_monitor_status Monitor status (1=UP, 0=DOWN, 2=RETRYING, 3=PAUSED)',
      '# TYPE uptime_monitor_status gauge',
    ];

    const now = Date.now();

    for (const m of monitors || []) {
      let statusCode = 1; // UP
      if (m.paused === 1 || m.status === 'PAUSED') statusCode = 3;
      else if (m.status === 'DOWN') statusCode = 0;
      else if (m.status === 'RETRYING') statusCode = 2;

      const safeName = (m.name || '').replace(/"/g, '\\"');
      const safeUrl = (m.url || '').replace(/"/g, '\\"');

      lines.push(`uptime_monitor_status{id="${m.id}",name="${safeName}",url="${safeUrl}"} ${statusCode}`);
    }

    lines.push(
      '# HELP uptime_monitor_latency_ms Monitor latest latency in milliseconds',
      '# TYPE uptime_monitor_latency_ms gauge'
    );
    for (const m of monitors || []) {
      const lat = latMap.get(m.id) ?? -1;
      const safeName = (m.name || '').replace(/"/g, '\\"');
      lines.push(`uptime_monitor_latency_ms{id="${m.id}",name="${safeName}"} ${lat}`);
    }

    lines.push(
      '# HELP uptime_monitor_cert_expiry_days SSL certificate days remaining',
      '# TYPE uptime_monitor_cert_expiry_days gauge'
    );
    for (const m of monitors || []) {
      if (m.cert_expiry) {
        const daysLeft = Math.max(0, Math.ceil((new Date(m.cert_expiry).getTime() - now) / 86400000));
        const safeName = (m.name || '').replace(/"/g, '\\"');
        lines.push(`uptime_monitor_cert_expiry_days{id="${m.id}",name="${safeName}"} ${daysLeft}`);
      }
    }

    c.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    c.header('Cache-Control', 'no-cache');
    return c.text(lines.join('\n') + '\n');
  } catch (e: unknown) {
    return c.text(`# Error exporting metrics: ${e instanceof Error ? e.message : 'Unknown error'}\n`, 500);
  }
});

system.post('/test-alert', async (c) => {
  try {
    const mockMonitor = { name: 'Test Monitor', url: 'https://example.com' } as Monitor;
    const sent = await sendAlertToAllChannels(c.env, mockMonitor, 'DOWN', '这是一条测试消息，用于验证通知渠道配置。');
    return c.json({ success: sent });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

export default settings;
