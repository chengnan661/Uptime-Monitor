import { Bindings } from '../types';
import { getAuthSecret } from './cors';

const textEncoder = new TextEncoder();

export function base64UrlEncode(input: string | ArrayBuffer): string {
  const bytes = typeof input === 'string' ? textEncoder.encode(input) : new Uint8Array(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - input.length % 4) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(value)));
}

export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = ha.length ^ hb.length;
  for (let i = 0; i < Math.max(ha.length, hb.length); i++) {
    diff |= (ha[i] || 0) ^ (hb[i] || 0);
  }
  return diff === 0;
}

export async function hmacSha256(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return base64UrlEncode(await crypto.subtle.sign('HMAC', key, textEncoder.encode(value)));
}

export async function verifyAdminCredential(env: Bindings, credential: string): Promise<boolean> {
  const candidates = [env.ADMIN_API_KEY, env.ADMIN_PASSWORD].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (await safeEqual(credential, candidate)) return true;
  }
  return false;
}

export async function createSessionToken(env: Bindings): Promise<{ token: string; expires_at: string }> {
  const secret = getAuthSecret(env);
  if (!secret) throw new Error('Admin auth is not configured');
  const configuredTtl = Number(env.SESSION_TTL_HOURS);
  const ttlHours = Number.isFinite(configuredTtl) && configuredTtl > 0
    ? Math.max(1, Math.min(configuredTtl, 168))
    : 12;
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000);
  const payload = base64UrlEncode(JSON.stringify({ exp: expiresAt.toISOString() }));
  const signature = await hmacSha256(secret, payload);
  return { token: `v1.${payload}.${signature}`, expires_at: expiresAt.toISOString() };
}

export async function verifySessionToken(env: Bindings, token: string): Promise<boolean> {
  const secret = getAuthSecret(env);
  if (!secret || !token.startsWith('v1.')) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [, payload, signature] = parts;
  const expected = await hmacSha256(secret, payload);
  if (!await safeEqual(signature, expected)) return false;
  try {
    const data = JSON.parse(base64UrlDecode(payload)) as { exp?: string };
    return !!data.exp && new Date(data.exp).getTime() > Date.now();
  } catch {
    return false;
  }
}
