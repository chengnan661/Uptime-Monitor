import { Bindings } from '../types';

export async function cleanupLogs(env: Bindings) {
  console.log('Starting log cleanup...');
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { meta: deletedOld } = await env.DB.prepare('DELETE FROM logs WHERE created_at < ?').bind(thirtyDaysAgo).run();
    console.log(`Deleted ${deletedOld.changes} old logs (>30d).`);

    const { results } = await env.DB.prepare('SELECT id FROM monitors').all<{ id: number }>();
    for (const monitor of results) {
      await env.DB.prepare(`
        DELETE FROM logs WHERE id IN (
          SELECT id FROM logs WHERE monitor_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 1000
        )
      `).bind(monitor.id).run();
    }
    console.log('Log cleanup completed.');
  } catch (e: unknown) {
    console.error('Log cleanup error:', e);
  }
}
