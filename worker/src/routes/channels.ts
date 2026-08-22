import { Hono } from 'hono';
import { Bindings, NotificationChannel, Monitor } from '../types';
import { sendToChannel, sendAlertToAllChannels } from '../services/notifier';

const channels = new Hono<{ Bindings: Bindings }>();

function maskSecret(val: string): string {
  if (!val || val.length <= 8) return '****';
  return val.slice(0, 4) + '****' + val.slice(-4);
}

function maskChannelConfig(channel: NotificationChannel): NotificationChannel {
  try {
    const cfg = JSON.parse(channel.config) as Record<string, unknown>;
    const masked: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(cfg)) {
      if (typeof v === 'string' && ['secret', 'token', 'access_token', 'bot_token', 'key'].some(s => k.toLowerCase().includes(s))) {
        masked[k] = maskSecret(v);
      } else {
        masked[k] = v;
      }
    }
    return { ...channel, config: JSON.stringify(masked) };
  } catch { return channel; }
}

channels.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM notification_channels ORDER BY created_at DESC').all<NotificationChannel>();
    return c.json((results || []).map(maskChannelConfig));
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

channels.post('/', async (c) => {
  try {
    const body = await c.req.json<{ type: string; name: string; config: Record<string, unknown>; enabled?: number }>();
    if (!body.type || !body.name || !body.config) return c.json({ error: 'Missing required fields' }, 400);
    const validTypes = ['dingtalk', 'wecom', 'feishu', 'telegram', 'webhook', 'email'];
    if (!validTypes.includes(body.type)) return c.json({ error: `Invalid type. Valid: ${validTypes.join(', ')}` }, 400);
    await c.env.DB.prepare('INSERT INTO notification_channels (type, name, enabled, config) VALUES (?, ?, ?, ?)')
      .bind(body.type, body.name, body.enabled ?? 1, JSON.stringify(body.config)).run();
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

channels.patch('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const body = await c.req.json<{ name?: string; enabled?: number; config?: Record<string, unknown> }>();
    const fields: string[] = [];
    const values: unknown[] = [];
    if (body.name !== undefined) { fields.push('name = ?'); values.push(body.name); }
    if (body.enabled !== undefined) { fields.push('enabled = ?'); values.push(body.enabled); }
    if (body.config !== undefined && Object.keys(body.config).length > 0) {
      const existing = await c.env.DB.prepare('SELECT config FROM notification_channels WHERE id = ?')
        .bind(id).first<{ config: string }>();
      let mergedConfig: Record<string, unknown> = {};
      if (existing?.config) { try { mergedConfig = JSON.parse(existing.config) as Record<string, unknown>; } catch { /**/ } }
      for (const [k, v] of Object.entries(body.config)) {
        if (v !== '' && v !== null && v !== undefined) mergedConfig[k] = v;
      }
      fields.push('config = ?'); values.push(JSON.stringify(mergedConfig));
    }
    if (fields.length === 0) return c.json({ error: 'No valid fields' }, 400);
    values.push(id);
    await c.env.DB.prepare(`UPDATE notification_channels SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

channels.delete('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare('DELETE FROM notification_channels WHERE id = ?').bind(id).run();
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

channels.post('/:id/test', async (c) => {
  const id = c.req.param('id');
  try {
    const channel = await c.env.DB.prepare('SELECT * FROM notification_channels WHERE id = ?').bind(id).first<NotificationChannel>();
    if (!channel) return c.json({ error: 'Channel not found' }, 404);
    const mockMonitor = { name: 'Test Monitor', url: 'https://example.com' } as Monitor;
    const sent = await sendToChannel(channel, mockMonitor, 'DOWN', '这是一条测试消息，用于验证通知渠道是否配置正确。');
    return c.json({ success: sent });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

export default channels;
