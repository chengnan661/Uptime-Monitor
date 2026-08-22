import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Bindings } from './types';
import { getAllowedOrigins, isLocalOrigin, getAuthSecret } from './utils/cors';
import { verifySessionToken, verifyAdminCredential } from './utils/crypto';
import { checkSites } from './services/checker';
import { cleanupLogs } from './services/cleanup';
import { checkExpiryAlerts } from './services/expiry';
import { aggregateDailyUptime } from './services/aggregate';

import authRoutes from './routes/auth';
import monitorRoutes from './routes/monitors';
import incidentRoutes from './routes/incidents';
import channelRoutes from './routes/channels';
import settingsRoutes, { system as systemRoutes } from './routes/settings';

const app = new Hono<{ Bindings: Bindings }>();

// 1. 全局 CORS 中间件
app.use('/*', cors({
  origin: (origin, c) => {
    if (!origin) return '*';
    if (isLocalOrigin(origin)) return origin;
    const allowedOrigins = getAllowedOrigins(c.env);
    if (allowedOrigins.length === 0) return origin;
    if (allowedOrigins.includes(origin)) return origin;
    return null;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Password', 'X-Admin-Api-Key', 'X-Session-Token'],
  maxAge: 86400,
}));

// 2. 全局鉴权中间件
app.use('/*', async (c, next) => {
  const path = c.req.path;
  const isPublicGet = c.req.method === 'GET' && [
    '/monitors/public',
    '/monitors/public/details',
    '/incidents',
    '/settings',
    '/health',
  ].includes(path);

  if (path === '/auth/login' || isPublicGet) {
    return next();
  }

  const authSecret = getAuthSecret(c.env);
  if (!authSecret) return c.json({ error: 'Admin auth is not configured' }, 503);

  const authHeader = c.req.header('Authorization');
  const sessionToken = c.req.header('X-Session-Token') || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);
  if (sessionToken && await verifySessionToken(c.env, sessionToken)) return next();

  const legacyHeaderKey = c.req.header('X-Admin-Api-Key') || c.req.header('X-Admin-Password');
  if (legacyHeaderKey && await verifyAdminCredential(c.env, legacyHeaderKey)) return next();

  return c.json({ error: 'Unauthorized' }, 401);
});

// 3. 挂载子路由
app.route('/auth', authRoutes);
app.route('/monitors', monitorRoutes);
app.route('/incidents', incidentRoutes);
app.route('/notification-channels', channelRoutes);
app.route('/settings', settingsRoutes);
app.route('/', systemRoutes);

// 4. 定时任务句柄
async function runScheduledTasks(env: Bindings) {
  const hour = new Date().getUTCHours();
  const tasks: Promise<void>[] = [checkSites(env)];
  if (hour === 2) {
    tasks.push(cleanupLogs(env));
    tasks.push(checkExpiryAlerts(env));
    tasks.push(aggregateDailyUptime(env));
  }
  await Promise.all(tasks);
}

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledTasks(env));
  },
};
