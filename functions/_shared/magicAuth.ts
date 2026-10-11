/** Email magic-link / code challenge helpers (LAYOUTS KV). */

import {
  type AuthEnv,
  type SessionPayload,
  sessionMaxAge,
} from './session';

const CHALLENGE_TTL = 600; // 10 min
const RATE_TTL = 900; // 15 min
const RATE_MAX = 5;
const MAX_ATTEMPTS = 5;

type ChallengeRecord = {
  codeHash: string;
  token: string;
  exp: number;
  attempts: number;
};

type RateRecord = { count: number; exp: number };

function bytesToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

function randomDigits(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < n; i++) out += String(bytes[i]! % 10);
  return out;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function normalizeEmail(email: string): string | null {
  const e = email.trim().toLowerCase();
  if (!e || e.length > 254) return null;
  // Basic RFC-ish: local@domain with at least one dot in domain
  const m = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.exec(
    e,
  );
  if (!m) return null;
  return e;
}

export async function hashCode(code: string, secret: string): Promise<string> {
  const data = new TextEncoder().encode(`${secret}:${code}`);
  return bytesToHex(await crypto.subtle.digest('SHA-256', data));
}

async function emailHash(email: string): Promise<string> {
  const data = new TextEncoder().encode(email);
  return bytesToHex(await crypto.subtle.digest('SHA-256', data));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i)! ^ b.charCodeAt(i)!;
  return diff === 0;
}

function displayName(email: string): string {
  const local = email.split('@')[0] ?? '';
  return local.length > 0 ? local : email;
}

function sessionFields(email: string): Pick<SessionPayload, 'sub' | 'email' | 'name' | 'exp'> {
  return {
    sub: `email:${email}`,
    email,
    name: displayName(email),
    exp: Math.floor(Date.now() / 1000) + sessionMaxAge(),
  };
}

async function checkRateLimit(kv: KVNamespace, eHash: string): Promise<boolean> {
  const key = `magicrl:${eHash}`;
  let rec: RateRecord | null = null;
  try {
    rec = (await kv.get(key, 'json')) as RateRecord | null;
  } catch {
    rec = null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (rec && rec.exp > now && rec.count >= RATE_MAX) return false;
  const count = rec && rec.exp > now ? rec.count + 1 : 1;
  const exp = rec && rec.exp > now ? rec.exp : now + RATE_TTL;
  await kv.put(key, JSON.stringify({ count, exp }), {
    expirationTtl: Math.max(60, exp - now),
  });
  return true;
}

export type CreateChallengeResult =
  | { ok: true; code: string; linkToken: string }
  | { ok: false; reason: 'rate_limited' | 'misconfigured' };

export async function createChallenge(
  env: AuthEnv,
  email: string,
): Promise<CreateChallengeResult> {
  if (!env.LAYOUTS || !env.SESSION_SECRET) {
    return { ok: false, reason: 'misconfigured' };
  }
  const eHash = await emailHash(email);
  const allowed = await checkRateLimit(env.LAYOUTS, eHash);
  if (!allowed) return { ok: false, reason: 'rate_limited' };

  const code = randomDigits(6);
  const linkToken = randomToken();
  const codeHash = await hashCode(code, env.SESSION_SECRET);
  const exp = Math.floor(Date.now() / 1000) + CHALLENGE_TTL;
  const record: ChallengeRecord = { codeHash, token: linkToken, exp, attempts: 0 };

  await env.LAYOUTS.put(`magic:${eHash}`, JSON.stringify(record), {
    expirationTtl: CHALLENGE_TTL,
  });
  // Reverse lookup for magic-link callback
  await env.LAYOUTS.put(`magictok:${linkToken}`, email, {
    expirationTtl: CHALLENGE_TTL,
  });

  return { ok: true, code, linkToken };
}

export type VerifyCodeResult =
  | { ok: true; session: Pick<SessionPayload, 'sub' | 'email' | 'name' | 'exp'> }
  | { ok: false; reason: 'invalid' | 'expired' | 'locked' | 'misconfigured' };

export async function verifyCode(
  env: AuthEnv,
  email: string,
  code: string,
): Promise<VerifyCodeResult> {
  if (!env.LAYOUTS || !env.SESSION_SECRET) {
    return { ok: false, reason: 'misconfigured' };
  }
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) return { ok: false, reason: 'invalid' };

  const eHash = await emailHash(email);
  const key = `magic:${eHash}`;
  let rec: ChallengeRecord | null = null;
  try {
    rec = (await env.LAYOUTS.get(key, 'json')) as ChallengeRecord | null;
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!rec) return { ok: false, reason: 'invalid' };

  const now = Math.floor(Date.now() / 1000);
  if (rec.exp < now) {
    await env.LAYOUTS.delete(key);
    return { ok: false, reason: 'expired' };
  }
  if (rec.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked' };

  const expect = await hashCode(trimmed, env.SESSION_SECRET);
  if (!timingSafeEqual(expect, rec.codeHash)) {
    rec.attempts += 1;
    const ttl = Math.max(30, rec.exp - now);
    await env.LAYOUTS.put(key, JSON.stringify(rec), { expirationTtl: ttl });
    if (rec.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'locked' };
    return { ok: false, reason: 'invalid' };
  }

  // Consume challenge + reverse token
  await env.LAYOUTS.delete(key);
  try {
    await env.LAYOUTS.delete(`magictok:${rec.token}`);
  } catch {
    /* ignore */
  }

  return { ok: true, session: sessionFields(email) };
}

export async function verifyLinkToken(
  env: AuthEnv,
  token: string,
): Promise<string | null> {
  if (!env.LAYOUTS || !token || token.length < 16) return null;
  let email: string | null = null;
  try {
    email = await env.LAYOUTS.get(`magictok:${token}`);
  } catch {
    return null;
  }
  if (!email) return null;

  const eHash = await emailHash(email);
  const key = `magic:${eHash}`;
  let rec: ChallengeRecord | null = null;
  try {
    rec = (await env.LAYOUTS.get(key, 'json')) as ChallengeRecord | null;
  } catch {
    return null;
  }
  if (!rec || rec.token !== token) return null;
  const now = Math.floor(Date.now() / 1000);
  if (rec.exp < now) {
    await env.LAYOUTS.delete(key);
    await env.LAYOUTS.delete(`magictok:${token}`);
    return null;
  }

  await env.LAYOUTS.delete(key);
  await env.LAYOUTS.delete(`magictok:${token}`);
  return email;
}

export { displayName as magicDisplayName, sessionFields as magicSessionFields };
