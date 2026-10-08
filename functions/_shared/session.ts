/** HMAC-signed session cookie helpers for Google/Microsoft OAuth + magic link. */

export type SessionPayload = {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  exp: number;
};

export type AuthEnv = {
  SESSION_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  PUBLIC_ORIGIN?: string;
  RESEND_API_KEY?: string;
  MAGIC_FROM_EMAIL?: string;
  LAYOUTS?: KVNamespace;
};

const COOKIE = 'mw_session';
const STATE_COOKIE = 'mw_oauth_state';
const MS_STATE_COOKIE = 'mw_ms_oauth_state';
const MAX_AGE = 30 * 24 * 60 * 60; // ~30d

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(secret);
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function signSession(
  payload: SessionPayload,
  secret: string,
): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return `${body}.${sig}`;
}

export async function verifySession(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!body || !sig) return null;
  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      b64urlDecode(sig),
      new TextEncoder().encode(body),
    );
    if (!ok) return null;
    const json = new TextDecoder().decode(b64urlDecode(body));
    const payload = JSON.parse(json) as SessionPayload;
    if (!payload?.sub || !payload?.email || typeof payload.exp !== 'number') return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('Cookie') ?? '';
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function getSession(
  request: Request,
  env: AuthEnv,
): Promise<SessionPayload | null> {
  if (!env.SESSION_SECRET) return null;
  const cookies = parseCookies(request);
  const raw = cookies[COOKIE];
  if (!raw) return null;
  return verifySession(raw, env.SESSION_SECRET);
}

export function setSessionCookie(token: string): string {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function setOAuthStateCookie(state: string): string {
  return `${STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

export function clearOAuthStateCookie(): string {
  return `${STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function getOAuthState(request: Request): string | null {
  return parseCookies(request)[STATE_COOKIE] ?? null;
}

export function setMsOAuthStateCookie(state: string): string {
  return `${MS_STATE_COOKIE}=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

export function clearMsOAuthStateCookie(): string {
  return `${MS_STATE_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function getMsOAuthState(request: Request): string | null {
  return parseCookies(request)[MS_STATE_COOKIE] ?? null;
}

export function publicOrigin(request: Request, env: AuthEnv): string {
  if (env.PUBLIC_ORIGIN) return env.PUBLIC_ORIGIN.replace(/\/$/, '');
  return new URL(request.url).origin;
}

export function sessionMaxAge(): number {
  return MAX_AGE;
}

export { COOKIE as SESSION_COOKIE, STATE_COOKIE, MS_STATE_COOKIE };
