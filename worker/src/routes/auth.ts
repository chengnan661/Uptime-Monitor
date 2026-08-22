import { Hono } from 'hono';
import { Bindings } from '../types';
import { getAuthSecret } from '../utils/cors';
import { verifyAdminCredential, createSessionToken } from '../utils/crypto';

const auth = new Hono<{ Bindings: Bindings }>();

auth.post('/login', async (c) => {
  try {
    const body = await c.req.json<{ password?: string }>();
    if (!body.password) return c.json({ error: 'Password is required' }, 400);
    if (!getAuthSecret(c.env)) return c.json({ error: 'Admin auth is not configured' }, 503);
    if (!await verifyAdminCredential(c.env, body.password)) return c.json({ error: 'Invalid password' }, 401);
    const session = await createSessionToken(c.env);
    return c.json(session);
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500);
  }
});

export default auth;
