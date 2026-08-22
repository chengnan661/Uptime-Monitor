import { Bindings, Monitor, NotificationChannel, DingTalkResult } from '../types';

export function buildAlertMessage(monitor: Pick<Monitor, 'name' | 'url'>, type: 'DOWN' | 'UP', detail: string) {
  const isDown = type === 'DOWN';
  const title = isDown ? '🔴 服务故障报警' : '🟢 服务恢复通知';
  const statusText = isDown ? '故障' : '正常';
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  return { title, statusText, time, isDown, detail, monitorName: monitor.name, monitorUrl: monitor.url };
}

export async function renderAlertDetail(
  env: Bindings,
  key: string,
  fallback: string,
  vars: Record<string, string>,
  monitor: Pick<Monitor, 'name' | 'url'>
): Promise<string> {
  let template = fallback;
  try {
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
    if (row?.value) template = row.value;
  } catch { /* keep fallback */ }
  const values: Record<string, string> = {
    name: monitor.name,
    url: monitor.url,
    time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    ...vars,
  };
  return template.replace(/\{([a-z_]+)\}/g, (_, name: string) => values[name] ?? '');
}

export async function sendAlertToAllChannels(
  env: Bindings,
  monitor: Pick<Monitor, 'name' | 'url'> & { channel_ids?: string | null },
  type: 'DOWN' | 'UP',
  detail: string
): Promise<boolean> {
  try {
    const { results } = await env.DB.prepare('SELECT * FROM notification_channels WHERE enabled = 1').all<NotificationChannel>();
    if (results && results.length > 0) {
      let filteredChannels = results;
      if (monitor.channel_ids && monitor.channel_ids.trim()) {
        const allowedIds = monitor.channel_ids.split(',').map(s => s.trim()).filter(Boolean);
        if (allowedIds.length > 0) {
          filteredChannels = results.filter(ch => allowedIds.includes(String(ch.id)));
        }
      }
      if (filteredChannels.length > 0) {
        const tasks = filteredChannels.map(ch => sendToChannel(ch, monitor, type, detail));
        const outcomes = await Promise.allSettled(tasks);
        return outcomes.some(o => o.status === 'fulfilled' && o.value === true);
      }
    }
  } catch (e) {
    console.error('Failed to read notification channels from DB:', e);
  }

  if (env.DINGTALK_ACCESS_TOKEN && env.DINGTALK_SECRET) {
    const fallbackChannel: NotificationChannel = {
      id: 0,
      type: 'dingtalk',
      name: 'ENV DingTalk',
      enabled: 1,
      config: JSON.stringify({ access_token: env.DINGTALK_ACCESS_TOKEN, secret: env.DINGTALK_SECRET }),
      created_at: '',
    };
    return sendToChannel(fallbackChannel, monitor, type, detail);
  }

  console.warn('No notification channels configured.');
  return false;
}

export async function sendToChannel(
  channel: NotificationChannel,
  monitor: Pick<Monitor, 'name' | 'url'>,
  type: 'DOWN' | 'UP',
  detail: string
): Promise<boolean> {
  const cfg = JSON.parse(channel.config) as Record<string, string>;
  try {
    switch (channel.type) {
      case 'dingtalk': return await sendDingTalk(cfg, monitor, type, detail);
      case 'wecom':    return await sendWeCom(cfg, monitor, type, detail);
      case 'feishu':   return await sendFeishu(cfg, monitor, type, detail);
      case 'telegram': return await sendTelegram(cfg, monitor, type, detail);
      case 'webhook':  return await sendWebhook(cfg, monitor, type, detail);
      case 'email':    return await sendEmail(cfg, monitor, type, detail);
      default:
        console.warn(`Unknown channel type: ${channel.type}`);
        return false;
    }
  } catch (e) {
    console.error(`Failed to send via ${channel.type} (${channel.name}):`, e);
    return false;
  }
}

// ── 钉钉 ──────────────────────────────────────────────────────
async function sendDingTalk(cfg: Record<string, string>, monitor: Pick<Monitor, 'name' | 'url'>, type: 'DOWN' | 'UP', detail: string): Promise<boolean> {
  const { access_token, secret } = cfg;
  if (!access_token || !secret) { console.warn('DingTalk config missing.'); return false; }
  const timestamp = Date.now();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}\n${secret}`));
  const signEncoded = encodeURIComponent(btoa(String.fromCharCode(...new Uint8Array(signature))));
  const webhookUrl = `https://oapi.dingtalk.com/robot/send?access_token=${access_token}&timestamp=${timestamp}&sign=${signEncoded}`;
  const isDown = type === 'DOWN';
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const title = isDown ? '🚨 突发！服务又双叒叕挂了 (╯°□°)╯︵ ┻━┻' : '🎉 仰卧起坐成功！服务满血复活 ヾ(≧▽≦*)o';
  const statusLabel = isDown ? '<font color="#cc0000">💥 彻底躺平 (DOWN)</font>' : '<font color="#00aa55">✨ 支楞起来了 (UP)</font>';
  const markdownText = [
    `### ${title}`,
    `---`,
    `- **⚡ 大名：** ${monitor.name}`,
    `- **🏠 门牌：** [${monitor.url}](${monitor.url})`,
    `- **🚥 医嘱：** ${statusLabel}`,
    `- **📝 八卦：** ${detail}`,
    `---`,
    `> ${isDown ? '☕ 稳住别慌，带上薪水去拯救世界~' : '🚀 虚惊一场，接着奏乐接着舞~'}`,
    ``,
    `<font color="#999999">📅 ${time} &nbsp;·&nbsp; Uptime Monitor</font>`,
  ].join('\n');
  const resp = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'markdown', markdown: { title, text: markdownText } }) });
  const result = await resp.json<DingTalkResult>();
  if (result.errcode !== 0) { console.error('DingTalk API Error:', result); return false; }
  return true;
}

// ── 企业微信 ──────────────────────────────────────────────────
async function sendWeCom(cfg: Record<string, string>, monitor: Pick<Monitor, 'name' | 'url'>, type: 'DOWN' | 'UP', detail: string): Promise<boolean> {
  const { key } = cfg;
  if (!key) { console.warn('WeCom config missing.'); return false; }
  const isDown = type === 'DOWN';
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const title = isDown ? '🚨 突发！服务又双叒叕挂了 (╯°□°)╯︵ ┻━┻' : '🎉 仰卧起坐成功！服务满血复活 ヾ(≧▽≦*)o';
  const statusLabel = isDown ? '<font color="warning">💥 彻底躺平 (DOWN)</font>' : '<font color="info">✨ 支楞起来了 (UP)</font>';
  const content = [
    `### ${title}`,
    ``,
    `> **⚡ 大名：** <font color="comment">${monitor.name}</font>`,
    `> **🏠 门牌：** [${monitor.url}](${monitor.url})`,
    `> **🚥 医嘱：** ${statusLabel}`,
    `> **📝 八卦：** <font color="comment">${detail}</font>`,
    ``,
    `> <font color="comment">${isDown ? '☕ 稳住别慌，带上薪水去拯救世界~' : '🚀 虚惊一场，接着奏乐接着舞~'}</font>`,
    `<font color="comment">📅 ${time} · Uptime Monitor</font>`
  ].join('\n');
  const resp = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }) });
  const result = await resp.json<{ errcode: number }>();
  if (result.errcode !== 0) { console.error('WeCom API Error:', result); return false; }
  return true;
}

// ── 飞书 ──────────────────────────────────────────────────────
async function sendFeishu(cfg: Record<string, string>, monitor: Pick<Monitor, 'name' | 'url'>, type: 'DOWN' | 'UP', detail: string): Promise<boolean> {
  const { webhook_url, secret } = cfg;
  if (!webhook_url) { console.warn('Feishu config missing.'); return false; }
  const isDown = type === 'DOWN';
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const title = isDown ? '🚨 突发！服务又双叒叕挂了 (╯°□°)╯︵ ┻━┻' : '🎉 仰卧起坐成功！服务满血复活 ヾ(≧▽≦*)o';
  const statusFeishu = isDown ? '<font color="red">💥 彻底躺平 (DOWN)</font>' : '<font color="green">✨ 支楞起来了 (UP)</font>';
  const card = {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: title }, template: isDown ? 'red' : 'green' },
    elements: [
      {
        tag: 'div',
        fields: [
          { is_short: true, text: { tag: 'lark_md', content: `**⚡ 大名**\n${monitor.name}` } },
          { is_short: true, text: { tag: 'lark_md', content: `**🚥 医嘱**\n${statusFeishu}` } }
        ]
      },
      { tag: 'div', text: { tag: 'lark_md', content: `**🏠 门牌**\n[${monitor.url}](${monitor.url})` } },
      { tag: 'div', text: { tag: 'lark_md', content: `**📝 八卦**\n${detail}` } },
      { tag: 'hr' },
      { tag: 'note', elements: [{ tag: 'plain_text', content: `${isDown ? '☕ 稳住别慌，带上薪水去拯救世界~' : '🚀 虚惊一场，接着奏乐接着舞~'}  |  📅 ${time}` }] },
    ],
  };
  const body: Record<string, unknown> = { msg_type: 'interactive', card };
  if (secret) {
    const timestamp = Math.floor(Date.now() / 1000);
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey('raw', enc.encode(`${timestamp}\n${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(''));
    body.timestamp = String(timestamp);
    body.sign = btoa(String.fromCharCode(...new Uint8Array(signature)));
  }
  const resp = await fetch(webhook_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await resp.json<{ code: number }>();
  if (result.code !== 0) { console.error('Feishu API Error:', result); return false; }
  return true;
}

// ── Telegram ──────────────────────────────────────────────────
async function sendTelegram(cfg: Record<string, string>, monitor: Pick<Monitor, 'name' | 'url'>, type: 'DOWN' | 'UP', detail: string): Promise<boolean> {
  const { bot_token, chat_id } = cfg;
  if (!bot_token || !chat_id) { console.warn('Telegram config missing.'); return false; }
  const isDown = type === 'DOWN';
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const text = [
    isDown ? '🚨 <b>突发！服务又双叒叕挂了 (╯°□°)╯︵ ┻━┻</b>' : '🎉 <b>仰卧起坐成功！服务满血复活 ヾ(≧▽≦*)o</b>',
    ``,
    `⚡ <b>大名：</b> <code>${monitor.name}</code>`,
    `🏠 <b>门牌：</b> <a href="${monitor.url}">${monitor.url}</a>`,
    `🚥 <b>医嘱：</b> ${isDown ? '💥 彻底躺平 (DOWN)' : '✨ 支楞起来了 (UP)'}`,
    `📝 <b>八卦：</b> <i>${detail}</i>`,
    ``,
    `☕ <i>${isDown ? '稳住别慌，带上薪水去拯救世界~' : '虚惊一场，接着奏乐接着舞~'}</i>`,
    `📅 <i>${time} · Uptime Monitor</i>`,
  ].join('\n');
  const resp = await fetch(`https://api.telegram.org/bot${bot_token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true }) });
  const result = await resp.json<{ ok: boolean }>();
  if (!result.ok) { console.error('Telegram API Error:', result); return false; }
  return true;
}

// ── 自定义 Webhook ────────────────────────────────────────────
async function sendWebhook(cfg: Record<string, string>, monitor: Pick<Monitor, 'name' | 'url'>, type: 'DOWN' | 'UP', detail: string): Promise<boolean> {
  const { url, method, headers: headersStr, secret } = cfg;
  if (!url) { console.warn('Webhook config missing.'); return false; }
  const msg = buildAlertMessage(monitor, type, detail);
  const payloadStr = JSON.stringify({
    event: type === 'DOWN' ? 'monitor.down' : 'monitor.up',
    monitor: { name: msg.monitorName, url: msg.monitorUrl },
    status: msg.statusText,
    detail: msg.detail,
    timestamp: msg.time
  });
  let parsedHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (headersStr) { try { parsedHeaders = { ...parsedHeaders, ...JSON.parse(headersStr) }; } catch { /* ignore */ } }
  
  if (secret) {
    const timestamp = String(Date.now());
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, enc.encode(`${timestamp}.${payloadStr}`));
    const hexSign = Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
    parsedHeaders['X-Uptime-Signature'] = `sha256=${hexSign}`;
    parsedHeaders['X-Uptime-Timestamp'] = timestamp;
  }

  const resp = await fetch(url, { method: (method || 'POST').toUpperCase(), headers: parsedHeaders, body: payloadStr });
  return resp.ok;
}

// ── Email（Resend API）──────────────────────────────────────
async function sendEmail(cfg: Record<string, string>, monitor: Pick<Monitor, 'name' | 'url'>, type: 'DOWN' | 'UP', detail: string): Promise<boolean> {
  const { api_key, from_email, to_email } = cfg;
  if (!api_key || !to_email) { console.warn('Email config missing.'); return false; }
  const isDown = type === 'DOWN';
  const time = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const title = isDown ? '🚨 突发！服务又双叒叕挂了 (╯°□°)╯︵ ┻━┻' : '🎉 仰卧起坐成功！服务满血复活 ヾ(≧▽≦*)o';
  const subject = title;
  const statusColor = isDown ? '#f43f5e' : '#10b981';
  const statusText = isDown ? '💥 彻底躺平 (DOWN)' : '✨ 支楞起来了 (UP)';
  const quote = isDown ? '☕ 稳住别慌，带上薪水去拯救世界~' : '🚀 虚惊一场，接着奏乐接着舞~';
  const html = `
<div style="font-family:'Segoe UI',Arial,sans-serif;max-width:520px;margin:0 auto;background:#0f172a;border-radius:16px;overflow:hidden;border:1px solid #1e293b;box-shadow:0 10px 25px -5px rgba(0,0,0,0.5)">
  <div style="padding:28px;background:linear-gradient(135deg,${isDown ? '#4c0519' : '#064e3b'},#0f172a);border-bottom:1px solid #1e293b">
    <h2 style="margin:0;color:#f8fafc;font-size:18px;line-height:1.4">${title}</h2>
  </div>
  <div style="padding:28px;color:#cbd5e1;line-height:1.8;font-size:15px">
    <p style="margin:0 0 12px"><strong>⚡ 大名：</strong> <span style="color:#f1f5f9">${monitor.name}</span></p>
    <p style="margin:0 0 12px"><strong>🏠 门牌：</strong> <a href="${monitor.url}" style="color:#38bdf8;text-decoration:none">${monitor.url}</a></p>
    <p style="margin:0 0 12px"><strong>🚥 医嘱：</strong> <span style="color:${statusColor};font-weight:700">${statusText}</span></p>
    <div style="margin:16px 0;padding:16px;background:#1e293b;border-radius:12px;border-left:4px solid ${statusColor}">
      <p style="margin:0;font-size:14px;color:#94a3b8"><strong>📝 八卦：</strong> ${detail}</p>
    </div>
    <p style="margin:24px 0 0;text-align:center;font-style:italic;color:#64748b">${quote}</p>
  </div>
  <div style="padding:16px 28px;background:#0b1120;text-align:center;font-size:12px;color:#475569">
    📅 ${time} · Uptime Monitor
  </div>
</div>`;
  const fromAddr = from_email || 'Uptime Monitor <noreply@resend.dev>';
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api_key}` },
    body: JSON.stringify({ from: fromAddr, to: to_email.split(',').map(s => s.trim()), subject, html }),
  });
  if (!resp.ok) { console.error('Resend API Error:', await resp.text()); return false; }
  return true;
}
