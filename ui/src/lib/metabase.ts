/**
 * Server-side Metabase API client (uses X-Api-Key auth).
 * Used by Next.js API routes.
 *
 * Env vars required (next.config.js must pass them through):
 *   METABASE_URL  – e.g. http://127.0.0.1:8082  (or http://host.docker.internal:8082 in Docker)
 *   METABASE_API_KEY
 */

import { BrandCode } from '@/lib/brand-server';

function requireMetabaseEnv() {
  const MB_URL = process.env.METABASE_URL;
  const MB_KEY = process.env.METABASE_API_KEY;
  if (!MB_URL || !MB_KEY) {
    throw new Error(
      'METABASE_URL and METABASE_API_KEY environment variables are required. ' +
        'Add them to .env.local (UI) or docker-compose environment section (VPS).'
    );
  }
  return { MB_URL, MB_KEY };
}

function baseHeaders() {
  const { MB_KEY } = requireMetabaseEnv();
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': MB_KEY,
  };
}

async function mbReq(method: 'GET' | 'PUT', path: string, body?: unknown) {
  const { MB_URL } = requireMetabaseEnv();
  const url = `${MB_URL}${path}`;
  const opts: RequestInit = {
    method,
    headers: baseHeaders(),
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
