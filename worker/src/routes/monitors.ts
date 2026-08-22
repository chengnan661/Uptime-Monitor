import { Hono } from 'hono';
import { Bindings, Monitor, Log, MONITOR_COLUMNS } from '../types';
import { performCheck, updateDomainCertInfo } from '../services/checker';

const monitors = new Hono<{ Bindings: Bindings }>();

// 1. 获取所有监控项（需鉴权在 index 中统一拦截，或者公共接口分离）
monitors.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(`SELECT ${MONITOR_COLUMNS} FROM monitors ORDER BY sort_order ASC, created_at ASC`).all<Monitor>();
    return c.json(results);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 2. 公开列表 API（无需鉴权）
monitors.get('/public', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, name, url, status, last_check, cert_expiry, domain_expiry, paused, tags FROM monitors ORDER BY sort_order ASC, created_at ASC'
    ).all<Pick<Monitor, 'id' | 'name' | 'url' | 'status' | 'last_check' | 'cert_expiry' | 'domain_expiry' | 'paused' | 'tags'>>();
    
    // 设置 Cache-Control 允许边缘节点与客户端缓存 30s，降低 D1 Read 开销
    c.header('Cache-Control', 'public, max-age=30, s-maxage=30');
    return c.json(results);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 3. 公开详情 API：含延迟、可用率、90天历史（无需鉴权）
monitors.get('/public/details', async (c) => {
  try {
    const { results: monitorsList } = await c.env.DB.prepare(
      'SELECT id, name, url, status, last_check, cert_expiry, domain_expiry, paused, tags FROM monitors ORDER BY sort_order ASC, created_at ASC'
    ).all();
    if (!monitorsList || monitorsList.length === 0) return c.json({ monitors: [] });

    await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS daily_uptime (
      monitor_id INTEGER NOT NULL, date TEXT NOT NULL,
      total_checks INTEGER DEFAULT 0, successful_checks INTEGER DEFAULT 0,
      avg_latency INTEGER DEFAULT 0, PRIMARY KEY (monitor_id, date)
    )`).run();

    const cnt = await c.env.DB.prepare('SELECT COUNT(*) as c FROM daily_uptime').first<{ c: number }>();
    if (cnt && cnt.c === 0) {
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO daily_uptime (monitor_id, date, total_checks, successful_checks, avg_latency)
        SELECT monitor_id, date(created_at), COUNT(*), SUM(CASE WHEN is_fail=0 THEN 1 ELSE 0 END),
               COALESCE(CAST(AVG(CASE WHEN is_fail=0 THEN latency END) AS INTEGER), 0)
        FROM logs
        WHERE created_at >= date('now','-90 days') AND created_at < date('now')
        GROUP BY monitor_id, date(created_at)
      `).run();
    }

    const { results: dailyRows } = await c.env.DB.prepare(
      "SELECT monitor_id, date, total_checks, successful_checks FROM daily_uptime WHERE date >= date('now','-90 days') ORDER BY monitor_id, date"
    ).all();

    const { results: liveRows } = await c.env.DB.prepare(`
      SELECT monitor_id,
        SUM(CASE WHEN created_at >= datetime('now','-24 hours') THEN 1 ELSE 0 END) as t24,
        SUM(CASE WHEN created_at >= datetime('now','-24 hours') AND is_fail=0 THEN 1 ELSE 0 END) as s24,
        SUM(CASE WHEN created_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) as t7,
        SUM(CASE WHEN created_at >= datetime('now','-7 days') AND is_fail=0 THEN 1 ELSE 0 END) as s7,
        COUNT(*) as t30, SUM(CASE WHEN is_fail=0 THEN 1 ELSE 0 END) as s30
      FROM logs WHERE created_at >= datetime('now','-30 days') GROUP BY monitor_id
    `).all();

    const { results: latRows } = await c.env.DB.prepare(
      'SELECT monitor_id, latency FROM logs WHERE is_fail=0 ORDER BY created_at DESC LIMIT 200'
    ).all();

    type DS = { date: string; up: number; total: number };
    const dMap = new Map<number, DS[]>();
    for (const r of dailyRows || []) {
      const id = r.monitor_id as number;
      if (!dMap.has(id)) dMap.set(id, []);
      dMap.get(id)!.push({ date: r.date as string, up: r.successful_checks as number, total: r.total_checks as number });
    }
    const sMap = new Map<number, Record<string, number>>();
    for (const r of liveRows || []) sMap.set(r.monitor_id as number, r as Record<string, number>);
    const lMap = new Map<number, number[]>();
    for (const r of latRows || []) {
      const id = r.monitor_id as number;
      if (!lMap.has(id)) lMap.set(id, []);
      const a = lMap.get(id)!;
      if (a.length < 24) a.push(r.latency as number);
    }
    for (const [, a] of lMap) a.reverse();

    const pct = (t?: number, s?: number) => t && t > 0 ? Number(((s! / t) * 100).toFixed(1)) : null;
    const enriched = monitorsList.map(m => {
      const id = m.id as number, s = sMap.get(id), lat = lMap.get(id) || [];
      return {
        ...m,
        latency: lat.length > 0 ? lat[lat.length - 1] : null,
        uptime_24h: pct(s?.t24, s?.s24),
        uptime_7d: pct(s?.t7, s?.s7),
        uptime_30d: pct(s?.t30, s?.s30),
        daily_stats: dMap.get(id) || [],
        recent_latencies: lat,
      };
    });

    c.header('Cache-Control', 'public, max-age=30, s-maxage=30');
    return c.json({ monitors: enriched });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 4. 批量操作 API
monitors.post('/batch', async (c) => {
  try {
    const body = await c.req.json<{ action: 'pause' | 'resume' | 'delete'; ids: number[] }>();
    const { action, ids } = body;
    if (!action || !ids || !Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: 'Missing action or ids' }, 400);
    }
    const placeholders = ids.map(() => '?').join(',');
    switch (action) {
      case 'pause':
        await c.env.DB.prepare(`UPDATE monitors SET paused = 1, status = 'PAUSED', retry_count = 0 WHERE id IN (${placeholders})`)
          .bind(...ids).run();
        break;
      case 'resume':
        await c.env.DB.prepare(`UPDATE monitors SET paused = 0, status = 'UP', retry_count = 0 WHERE id IN (${placeholders})`)
          .bind(...ids).run();
        break;
      case 'delete':
        await c.env.DB.prepare(`DELETE FROM logs WHERE monitor_id IN (${placeholders})`).bind(...ids).run();
        await c.env.DB.prepare(`DELETE FROM monitors WHERE id IN (${placeholders})`).bind(...ids).run();
        break;
      default:
        return c.json({ error: 'Invalid action' }, 400);
    }
    return c.json({ success: true, affected: ids.length });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 5. 拖拽排序 API
monitors.put('/reorder', async (c) => {
  try {
    const body = await c.req.json<{ ids: number[] }>();
    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return c.json({ error: 'Missing ids array' }, 400);
    }
    const stmts = body.ids.map((id, idx) =>
      c.env.DB.prepare('UPDATE monitors SET sort_order = ? WHERE id = ?').bind(idx, id)
    );
    await c.env.DB.batch(stmts);
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 6. 新增监控项
monitors.post('/', async (c) => {
  try {
    const body = await c.req.json<Partial<Monitor>>();
    const { name, url, interval, keyword, user_agent, tags, request_headers, request_body, expected_codes, channel_ids } = body;

    if (!name || !url) {
      return c.json({ error: 'Missing name or url' }, 400);
    }

    const method = (body.method || 'GET').toUpperCase();

    const result = await c.env.DB.prepare(
      `INSERT INTO monitors (name, url, method, interval, keyword, user_agent, tags, request_headers, request_body, expected_codes, channel_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      name, url, method,
      interval || 300,
      keyword || null,
      user_agent || null,
      tags || null,
      request_headers || null,
      request_body || null,
      expected_codes || '200-299',
      channel_ids || null
    ).run();

    const newId = result.meta.last_row_id as number;

    c.executionCtx.waitUntil(
      (async () => {
        try {
          await c.env.DB.prepare('UPDATE monitors SET check_info_status = ? WHERE id = ?')
            .bind(new Date().toISOString(), newId).run();
          const { results } = await c.env.DB.prepare(`SELECT ${MONITOR_COLUMNS} FROM monitors WHERE id = ?`)
            .bind(newId).all<Monitor>();
          if (results[0]) await updateDomainCertInfo(c.env, results[0]);
        } catch (err) { console.error('Initial cert check failed:', err); }
      })()
    );

    return c.json({ success: true, id: newId }, 201);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 7. 删除单条监控项
monitors.delete('/:id', async (c) => {
  const id = c.req.param('id');
  try {
    await c.env.DB.prepare('DELETE FROM logs WHERE monitor_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM monitors WHERE id = ?').bind(id).run();
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 8. 修改监控配置
monitors.patch('/:id/config', async (c) => {
  const id = c.req.param('id');
  try {
    const body = await c.req.json<Record<string, unknown>>();

    const fields: string[] = [];
    const values: unknown[] = [];

    const strFields: Array<[string, string]> = [
      ['name', 'name'], ['url', 'url'], ['keyword', 'keyword'],
      ['user_agent', 'user_agent'], ['tags', 'tags'],
      ['request_headers', 'request_headers'], ['request_body', 'request_body'],
      ['expected_codes', 'expected_codes'], ['channel_ids', 'channel_ids'],
    ];
    for (const [key, col] of strFields) {
      if (body[key] !== undefined) {
        if (key === 'name' || key === 'url') {
          if (typeof body[key] === 'string' && (body[key] as string).trim()) {
            fields.push(`${col} = ?`); values.push((body[key] as string).trim());
          }
        } else {
          fields.push(`${col} = ?`); values.push(body[key] || null);
        }
      }
    }

    if (body.interval !== undefined) {
      const iv = Number(body.interval);
      if (!isNaN(iv) && iv >= 60) { fields.push('interval = ?'); values.push(iv); }
    }
    if (body.method !== undefined) {
      fields.push('method = ?'); values.push(String(body.method).toUpperCase());
    }

    const flagFields = ['check_ssl', 'check_domain'];
    for (const k of flagFields) {
      if (body[k] !== undefined) { fields.push(`${k} = ?`); values.push(body[k] ? 1 : 0); }
    }

    const numFields = ['alert_silence_uptime', 'alert_silence_ssl', 'alert_silence_domain', 'alert_error_rate'];
    for (const k of numFields) {
      if (body[k] !== undefined) {
        const h = Number(body[k]);
        if (!isNaN(h) && h >= 0) { fields.push(`${k} = ?`); values.push(h); }
      }
    }

    if (fields.length === 0) return c.json({ error: 'No valid fields to update' }, 400);
    values.push(id);

    await c.env.DB.prepare(`UPDATE monitors SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 9. 手动触发单次检查
monitors.post('/:id/check', async (c) => {
  const id = c.req.param('id');
  try {
    const { results } = await c.env.DB.prepare(`SELECT ${MONITOR_COLUMNS} FROM monitors WHERE id = ?`).bind(id).all<Monitor>();
    if (!results[0]) return c.json({ error: 'Monitor not found' }, 404);

    await updateDomainCertInfo(c.env, results[0]);
    await c.env.DB.prepare('UPDATE monitors SET check_info_status = ? WHERE id = ?')
      .bind(new Date().toISOString(), id).run();

    await performCheck(results[0], c.env);

    return c.json({ success: true });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 10. 暂停/恢复监控
monitors.patch('/:id/pause', async (c) => {
  const id = c.req.param('id');
  try {
    const { results } = await c.env.DB.prepare('SELECT paused, status FROM monitors WHERE id = ?')
      .bind(id).all<Pick<Monitor, 'paused' | 'status'>>();
    if (!results[0]) return c.json({ error: 'Monitor not found' }, 404);

    const newPaused = results[0].paused === 1 ? 0 : 1;
    const newStatus: Monitor['status'] = newPaused ? 'PAUSED' : 'UP';

    await c.env.DB.prepare('UPDATE monitors SET paused = ?, status = ?, retry_count = 0 WHERE id = ?')
      .bind(newPaused, newStatus, id).run();
    return c.json({ success: true, paused: newPaused === 1, status: newStatus });
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 11. 获取日志
monitors.get('/:id/logs', async (c) => {
  const id = c.req.param('id');
  const limit = Math.min(Number(c.req.query('limit') || 50), 200);
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM logs WHERE monitor_id = ? ORDER BY created_at DESC LIMIT ?'
    ).bind(id, limit).all<Log>();
    return c.json(results);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

// 12. 可用率统计 API
monitors.get('/:id/stats', async (c) => {
  const id = c.req.param('id');
  try {
    const periods = [
      { key: 'h24', hours: 24 },
      { key: 'd7',  hours: 24 * 7 },
      { key: 'd30', hours: 24 * 30 },
    ];

    const stats: Record<string, string | null> = {};
    for (const { key, hours } of periods) {
      const since = new Date(Date.now() - hours * 3_600_000).toISOString();
      const row = await c.env.DB.prepare(
        'SELECT COUNT(*) as total, SUM(CASE WHEN is_fail = 0 THEN 1 ELSE 0 END) as success FROM logs WHERE monitor_id = ? AND created_at >= ?'
      ).bind(id, since).first<{ total: number; success: number }>();
      if (row && row.total > 0) {
        stats[key] = ((row.success / row.total) * 100).toFixed(2);
      } else {
        stats[key] = null;
      }
    }
    return c.json(stats);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

export default monitors;
