import { Bindings } from '../types';

export function getAllowedOrigins(env: Bindings): string[] {
  return (env.ALLOWED_ORIGIN || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

export function isLocalOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

export function getAuthSecret(env: Bindings): string | null {
  return env.ADMIN_API_KEY || env.ADMIN_PASSWORD || null;
}
