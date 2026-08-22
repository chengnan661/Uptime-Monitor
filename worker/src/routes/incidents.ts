import { Hono } from 'hono';
import { Bindings, Incident } from '../types';
import { toSqlDateTime } from '../utils/date';

const incidents = new Hono<{ Bindings: Bindings }>();

// 1. 公开：仅返回 active 事件
incidents.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM incidents WHERE status = 'active' ORDER BY created_at DESC"
    ).all<Incident>();
    return c.json(results || []);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 2. Admin：获取全部事件
incidents.get('/all', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM incidents ORDER BY created_at DESC LIMIT 100'
    ).all<Incident>();
    return c.json(results || []);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 3. 创建事件 / 计划维护
incidents.post('/', async (c) => {
  try {
    const body = await c.req.json<{
      title: string;
      description?: string;
      severity?: string;
      type?: string;
      scheduled_start?: string;
      scheduled_end?: string;
      affected_monitors?: string;
    }>();
    if (!body.title) return c.json({ error: 'Missing title' }, 400);
    const severity = ['info', 'warning', 'critical'].includes(body.severity || '') ? body.severity : 'info';
    const type = body.type === 'maintenance' ? 'maintenance' : 'incident';
    const scheduledStart = type === 'maintenance' ? toSqlDateTime(body.scheduled_start) : null;
    const scheduledEnd = type === 'maintenance' ? toSqlDateTime(body.scheduled_end) : null;
    if (type === 'maintenance' && (!scheduledStart || !scheduledEnd || scheduledEnd <= scheduledStart)) {
      return c.json({ error: 'Invalid maintenance window' }, 400);
    }
    const now = new Date().toISOString();
    const result = await c.env.DB.prepare(
      'INSERT INTO incidents (title, description, severity, status, type, scheduled_start, scheduled_end, affected_monitors, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(body.title, body.description || null, severity, 'active', type, scheduledStart, scheduledEnd, body.affected_monitors || null, now, now).run();
    return c.json({ success: true, id: result.meta.last_row_id }, 201);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 4. 更新事件状态
incidents.patch('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    const body = await c.req.json<{ title?: string; description?: string; severity?: string; status?: string }>();
    const fields: string[] = [];
    const values: unknown[] = [];
    const now = new Date().toISOString();

    if (body.title) { fields.push('title = ?'); values.push(body.title); }
    if (body.description !== undefined) { fields.push('description = ?'); values.push(body.description || null); }
    if (body.severity && ['info', 'warning', 'critical'].includes(body.severity)) {
      fields.push('severity = ?'); values.push(body.severity);
    }
    if (body.status === 'resolved') {
      fields.push("status = 'resolved'");
      fields.push('resolved_at = ?'); values.push(now);
    } else if (body.status === 'active') {
      fields.push("status = 'active'");
      fields.push('resolved_at = NULL');
    }
    fields.push('updated_at = ?'); values.push(now);

    if (fields.length <= 1) return c.json({ error: 'No valid fields' }, 400);
    values.push(id);

    await c.env.DB.prepare(`UPDATE incidents SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...values).run();
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 5. 删除事件
incidents.delete('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare('DELETE FROM incidents WHERE id = ?').bind(id).run();
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

export default incidents;
