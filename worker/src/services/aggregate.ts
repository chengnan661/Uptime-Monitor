import { Bindings } from '../types';

export async function aggregateDailyUptime(env: Bindings) {
  console.log('Aggregating daily uptime...');
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS daily_uptime (
      monitor_id INTEGER NOT NULL, date TEXT NOT NULL,
      total_checks INTEGER DEFAULT 0, successful_checks INTEGER DEFAULT 0,
      avg_latency INTEGER DEFAULT 0, PRIMARY KEY (monitor_id, date)
    )`).run();
    await env.DB.prepare(`
      INSERT OR REPLACE INTO daily_uptime (monitor_id, date, total_checks, successful_checks, avg_latency)
      SELECT monitor_id, date(created_at), COUNT(*), SUM(CASE WHEN is_fail=0 THEN 1 ELSE 0 END),
             COALESCE(CAST(AVG(CASE WHEN is_fail=0 THEN latency END) AS INTEGER), 0)
      FROM logs
      WHERE created_at >= date('now','-1 day') AND created_at < date('now')
      GROUP BY monitor_id, date(created_at)
    `).run();
    await env.DB.prepare("DELETE FROM daily_uptime WHERE date < date('now','-90 days')").run();
    console.log('Daily uptime aggregation completed.');
  } catch (e) {
    console.error('Daily uptime aggregation error:', e);
  }
}
