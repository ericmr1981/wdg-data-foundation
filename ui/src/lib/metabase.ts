/**
 * Server-side Metabase API client.
 * Used by Next.js API routes.
 *
 * Auth priority:
 * 1) X-Api-Key via METABASE_API_KEY
 * 2) Session login via METABASE_USER / METABASE_PASSWORD
 * 3) Fallback demo credentials documented in docs/METABASE_SETUP.md
 */

import { BrandCode } from '@/lib/brand-server';

let cachedSessionId: string | null = null;
let cachedSessionAt = 0;

function getMetabaseUrl() {
  return (
    process.env.METABASE_URL ||
    process.env.NEXT_PUBLIC_METABASE_URL ||
    'http://127.0.0.1:8082'
  ).replace(/\/$/, '');
}

function getApiKey() {
  return process.env.METABASE_API_KEY || '';
}

function getLoginCreds() {
  return {
    username: process.env.METABASE_USER || 'demo@metabase.com',
    password: process.env.METABASE_PASSWORD || 'demo123456',
  };
}

async function getSessionId() {
  const now = Date.now();
  if (cachedSessionId && now - cachedSessionAt < 30 * 60 * 1000) {
    return cachedSessionId;
  }

  const MB_URL = getMetabaseUrl();
  const { username, password } = getLoginCreds();
  // Metabase < 0.40 used "username" field; >= 0.40 uses "email"
  const res = await fetch(`${MB_URL}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (res.status >= 400) {
    const text = await res.text();
    throw new Error(
      'Metabase auth failed. Configure METABASE_API_KEY or valid METABASE_USER/METABASE_PASSWORD. ' +
      `POST /api/session → ${res.status}: ${text.slice(0, 300)}`
    );
  }

  const data = await res.json();
  if (!data?.id) {
    throw new Error('Metabase /api/session did not return session id');
  }

  cachedSessionId = data.id;
  cachedSessionAt = now;
  return cachedSessionId;
}

async function buildHeaders(): Promise<Record<string, string>> {
  const apiKey = getApiKey();
  if (apiKey) {
    return {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    };
  }

  const sessionId = await getSessionId();
  return {
    'Content-Type': 'application/json',
    'X-Metabase-Session': sessionId as string,
  };
}

async function mbReq(method: 'GET' | 'PUT', path: string, body?: unknown) {
  const MB_URL = getMetabaseUrl();
  const url = `${MB_URL}${path}`;
  const opts: RequestInit = {
    method,
    headers: await buildHeaders(),
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  let res = await fetch(url, opts);

  // Retry once if session expired
  if (res.status === 401 && !getApiKey()) {
    cachedSessionId = null;
    cachedSessionAt = 0;
    res = await fetch(url, {
      ...opts,
      headers: await buildHeaders(),
    });
  }

  if (res.status >= 400) {
    const text = await res.text();
    throw new Error(`Metabase ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

async function mbGet(path: string) {
  return mbReq('GET', path);
}

async function mbPut(path: string, body: unknown) {
  return mbReq('PUT', path, body);
}

/** Search Metabase dashboards by query string. */
export async function searchDashboards(q: string): Promise<Array<{ id: number; name: string }>> {
  const data = await mbGet(`/api/search?q=${encodeURIComponent(q)}&models=dashboard`);
  const items: any[] = Array.isArray(data?.data) ? data.data : [];
  return items
    .filter((d) => d.model === 'dashboard' && typeof d.id === 'number')
    .map((d) => ({ id: d.id, name: d.name }));
}

/** Search Metabase for a dashboard by exact name. */
export async function searchDashboard(name: string): Promise<{ id: number } | null> {
  const items = await searchDashboards(name);
  return items.find((d) => d.name === name) || null;
}

/** Get a dashboard with its parameters. */
export async function getDashboard(dashboardId: number): Promise<any> {
  return mbGet(`/api/dashboard/${dashboardId}`);
}

/** Update a dashboard's parameters array (partial update). */
export async function updateDashboardParameters(
  dashboardId: number,
  parameters: any[]
): Promise<void> {
  await mbPut(`/api/dashboard/${dashboardId}`, { parameters });
}

/**
 * Build the static-list store values from ops.stores rows.
 * Returns [[store_code, store_name], ...]
 */
export function buildStoreValues(
  rows: Array<{ store_code: string; store_name: string }>
): [string, string][] {
  return rows.map((r) => [r.store_code, r.store_name]);
}

/**
 * Find the store_code parameter in a dashboard's parameters array.
 * Returns the index and the parameter object, or null if not found.
 */
export function findStoreCodeParam(parameters: any[]): {
  index: number;
  param: any;
} | null {
  for (let i = 0; i < parameters.length; i++) {
    const p = parameters[i];
    if (p.slug === 'store_code' || p.name === 'Store Code' || p.id === PID_STORE) {
      return { index: i, param: p };
    }
  }
  return null;
}

// Stable parameter UUID matching the seed scripts
export const PID_STORE = '00000000-0000-0000-0000-000000000002';

/**
 * Brand → Metabase dashboard IDs mapping.
 * We sync ALL listed dashboards for the brand (e.g. 经营看板 + 财务/营业看板).
 *
 * Priority:
 * 1) METABASE_DASHBOARDS_<BRAND>="4,5,9" (comma-separated)
 * 2) METABASE_DASHBOARD_<BRAND>="9" (single)
 * 3) Fallback MAP (best-effort)
 */
export function getBrandDashboardIds(brand: BrandCode): number[] {
  const envKeyMany = `METABASE_DASHBOARDS_${brand.toUpperCase()}`;
  const envMany = process.env[envKeyMany];
  if (envMany) {
    const ids = envMany
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length) return Array.from(new Set(ids));
  }

  const envKeyOne = `METABASE_DASHBOARD_${brand.toUpperCase()}`;
  const envOne = process.env[envKeyOne];
  if (envOne) {
    const n = parseInt(envOne, 10);
    if (!isNaN(n) && n > 0) return [n];
  }

  // Best-effort defaults for this repo's seeded dashboards
  const MAP: Record<string, number[]> = {
    gelatomiiix: [8],
    yufeng: [9],
    bonjur: [4, 5],
  };
  return MAP[brand] ?? [];
}
