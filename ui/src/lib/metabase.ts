/**
 * Server-side Metabase API client (uses X-Api-Key auth).
 * Used by Next.js API routes.
 *
 * Env vars required (next.config.js must pass them through):
 *   METABASE_URL  – e.g. http://127.0.0.1:8082  (or http://host.docker.internal:8082 in Docker)
 *   METABASE_API_KEY
 */

import { BrandCode } from '@/lib/brand-server';

const MB_URL = process.env.METABASE_URL;
const MB_KEY = process.env.METABASE_API_KEY;

if (!MB_URL || !MB_KEY) {
  throw new Error(
    'METABASE_URL and METABASE_API_KEY environment variables are required. ' +
    'Add them to .env.local (UI) or docker-compose environment section (VPS).'
  );
}

const BASE_HEADERS = {
  'Content-Type': 'application/json',
  'X-Api-Key': MB_KEY,
};

async function mbReq(method: 'GET' | 'PUT', path: string, body?: unknown) {
  const url = `${MB_URL}${path}`;
  const opts: RequestInit = {
    method,
    headers: BASE_HEADERS,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(url, opts);
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

/** Search Metabase for a dashboard by name. */
export async function searchDashboard(name: string): Promise<{ id: number } | null> {
  const data = await mbGet(`/api/search?q=${encodeURIComponent(name)}&models=dashboard`);
  const items: any[] = Array.isArray(data?.data) ? data.data : [];
  return (items.find((d) => d.model === 'dashboard' && d.name === name)) || null;
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
 * Brand → Metabase dashboard ID mapping.
 * Main dashboard per brand (the "经营看板").
 *
 * How to find: GET /api/dashboard/{id}  or  GET /api/search?q=<品牌名>＋经营看板
 *
 * Override via env var: METABASE_DASHBOARD_<BRAND>  (e.g. METABASE_DASHBOARD_YUFENG=8)
 */
export function getBrandDashboardId(brand: BrandCode): number | null {
  const envKey = `METABASE_DASHBOARD_${brand.toUpperCase()}`;
  const envVal = process.env[envKey];
  if (envVal) {
    const n = parseInt(envVal, 10);
    if (!isNaN(n)) return n;
  }
  // Fallback to known IDs from seed scripts
  const MAP: Record<string, number> = {
    yufeng: 8,
    bonjur: 11, // Bonjur｜经营看板（对标榆枫） – adjust after seeding
    gelatomiiix: 12,
  };
  return MAP[brand] ?? null;
}
