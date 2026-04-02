/**
 * POST /api/admin/metabase/sync-store-dropdown
 *
 * Syncs the store_code static-list filter on existing Metabase dashboards
 * with the current ops.stores table for a given brand.
 *
 * Query params (optional):
 *   dry_run=true|false  (default: true)
 *   brand=<code>        (default: yufeng)
 *
 * Body (optional):
 *   { brand?: string; dry_run?: boolean }
 *
 * Response:
 *   {
 *     brand: string,
 *     dashboard_id: number,
 *     dashboard_name: string,
 *     dry_run: boolean,
 *     changes: {
 *       adds:    [store_code, store_name][]  – stores in ops.stores but not in the dropdown
 *       removes: [store_code, store_name][]  – stores in dropdown but not in ops.stores
 *       current: [store_code, store_name][]  – stores currently in the dropdown
 *       target:  [store_code, store_name][]  – stores that WILL be in the dropdown after apply
 *     }
 *   }
 *
 *   When dry_run=false (apply), also includes:
 *     applied: true
 *     log_file: string  – path to detailed log
 */

import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { normalizeBrand } from '@/lib/brand-server';
import {
  getBrandDashboardId,
  getDashboard,
  updateDashboardParameters,
  buildStoreValues,
  findStoreCodeParam,
  PID_STORE,
} from '@/lib/metabase';
import path from 'path';
import fs from 'fs';

type SyncChanges = {
  adds: [string, string][];
  removes: [string, string][];
  current: [string, string][];
  target: [string, string][];
};

const ARTIFACTS_DIR = path.join(process.cwd(), '../../artifacts');
const LOG_PREFIX = 'metabase-store-sync';

function ensureArtifactsDir() {
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }
}

function appendLog(filename: string, lines: string) {
  ensureArtifactsDir();
  const fpath = path.join(ARTIFACTS_DIR, filename);
  fs.appendFileSync(fpath, lines + '\n');
  return fpath;
}

function isoTs() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// ── GET stores from ops.stores ────────────────────────────────────────────────
async function fetchDbStores(brand: string): Promise<[string, string][]> {
  const res = await pool.query(
    `SELECT store_code, store_name
     FROM ops.stores
     WHERE brand_code = $1 AND enabled = true
     ORDER BY sort_order NULLS LAST, store_code`,
    [brand]
  );
  return res.rows.map((r: any) => [String(r.store_code), String(r.store_name)] as [string, string]);
}

// ── Dry-run: compute diff ─────────────────────────────────────────────────────
async function computeSync(brand: string, logFile: string) {
  const dashboardId = getBrandDashboardId(brand);

  if (!dashboardId) {
    // Try brand-name search as fallback
    appendLog(logFile, `[${isoTs()}] WARN: no dashboard ID for brand=${brand}, skipping search`);
    return {
      success: false,
      brand,
      error: `No dashboard ID known for brand "${brand}". ` +
        `Set METABASE_DASHBOARD_${brand.toUpperCase()} env var or update BRAND_DASHBOARD_MAP in metabase.ts.`,
    };
  }

  appendLog(logFile, `[${isoTs()}] Fetching dashboard ${dashboardId}…`);
  const dash = await getDashboard(dashboardId);
  const dashName: string = dash?.name ?? `dashboard-${dashboardId}`;
  const params: any[] = dash?.parameters ?? [];

  appendLog(logFile, `[${isoTs()}] Dashboard params: ${JSON.stringify(params.map((p) => ({ id: p.id, slug: p.slug, name: p.name })))}`);

  const found = findStoreCodeParam(params);
  if (!found) {
    appendLog(logFile, `[${isoTs()}] ERROR: store_code parameter not found in dashboard ${dashboardId}`);
    return {
      success: false,
      brand,
      dashboard_id: dashboardId,
      dashboard_name: dashName,
      error: `Dashboard "${dashName}" (id=${dashboardId}) has no store_code filter parameter.`,
    };
  }

  const currentValues: [string, string][] = found.param.values_source_config?.values ?? [];
  const targetValues = await fetchDbStores(brand);

  const currentCodes = new Set(currentValues.map((v) => String(v[0])));
  const targetCodes = new Set(targetValues.map((v) => String(v[0])));

  const adds = targetValues.filter((v) => !currentCodes.has(String(v[0])));
  const removes = currentValues.filter((v) => !targetCodes.has(String(v[0])));

  appendLog(logFile, `[${isoTs()}] Current dropdown: ${JSON.stringify(currentValues)}`);
  appendLog(logFile, `[${isoTs()}] Target stores:   ${JSON.stringify(targetValues)}`);
  appendLog(logFile, `[${isoTs()}] Adds: ${adds.length}, Removes: ${removes.length}`);

  return {
    success: true,
    brand,
    dashboard_id: dashboardId,
    dashboard_name: dashName,
    param_id: found.param.id,
    param_slug: found.param.slug,
    changes: {
      adds,
      removes,
      current: currentValues,
      target: targetValues,
    },
  };
}

// ── Apply: write to Metabase ──────────────────────────────────────────────────
async function applySync(brand: string, dashboardId: number, targetValues: [string, string][], logFile: string) {
  appendLog(logFile, `[${isoTs()}] Fetching dashboard ${dashboardId} for apply…`);
  const dash = await getDashboard(dashboardId);
  const params: any[] = dash?.parameters ?? [];

  const found = findStoreCodeParam(params);
  if (!found) {
    appendLog(logFile, `[${isoTs()}] ERROR: store_code param not found on apply`);
    throw new Error('store_code parameter not found');
  }

  const updatedParam = {
    ...found.param,
    values_source_type: 'static-list',
    values_source_config: { values: targetValues },
  };

  const nextParams = [...params];
  nextParams[found.index] = updatedParam;

  appendLog(logFile, `[${isoTs()}] PUT /api/dashboard/${dashboardId}/parameters …`);
  appendLog(logFile, `[${isoTs()}] Updated param: ${JSON.stringify({ id: updatedParam.id, slug: updatedParam.slug, values_source_type: updatedParam.values_source_type, value_count: targetValues.length })}`);

  await updateDashboardParameters(dashboardId, nextParams);
  appendLog(logFile, `[${isoTs()}] Done — ${targetValues.length} store values written.`);
}

// ── POST handler ───────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: err.status || 401 });
  }

  const { searchParams } = new URL(request.url);
  const queryDryRun = searchParams.get('dry_run') !== 'false';
  const queryBrand = normalizeBrand(searchParams.get('brand'));

  let body: { brand?: string; dry_run?: boolean } = {};
  try {
    body = await request.clone().json();
  } catch {
    // empty body is fine
  }

  const brand = normalizeBrand(body.brand || queryBrand || 'yufeng')!;
  const dryRun = body.dry_run ?? queryDryRun;

  const ts = isoTs();
  const logFile = `${LOG_PREFIX}-${brand}-${ts}.log`;
  appendLog(logFile, `[${ts}] === Sync request: brand=${brand}, dry_run=${dryRun}, user=${user?.username} ===`);

  try {
    const result = await computeSync(brand, logFile);

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }

    if (dryRun) {
      appendLog(logFile, `[${isoTs()}] Dry-run complete — returning diff without applying.`);
      return NextResponse.json({
        success: true,
        dry_run: true,
        brand,
        dashboard_id: (result as any).dashboard_id,
        dashboard_name: (result as any).dashboard_name,
        changes: (result as any).changes,
        message: 'Dry-run complete. POST with dry_run=false to apply.',
      });
    }

    // Apply — result.success is true here so dashboard_id and changes are guaranteed
    const ok = result as { success: true; dashboard_id: number; dashboard_name: string; changes: { target: [string, string][] } };
    await applySync(brand, ok.dashboard_id, ok.changes.target, logFile);

    return NextResponse.json({
      success: true,
      dry_run: false,
      brand,
      dashboard_id: ok.dashboard_id,
      dashboard_name: ok.dashboard_name,
      changes: ok.changes,
      applied: true,
      log_file: logFile,
    });
  } catch (err: any) {
    appendLog(logFile, `[${isoTs()}] ERROR: ${err.message}`);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

// ── GET handler (convenience: just return the current diff without auth side-effects) ──
export async function GET(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin']);
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: err.status || 401 });
  }

  const { searchParams } = new URL(request.url);
  const brand = normalizeBrand(searchParams.get('brand') || 'yufeng')!;

  const ts = isoTs();
  const logFile = `${LOG_PREFIX}-${brand}-${ts}.log`;
  appendLog(logFile, `[${ts}] === GET preview: brand=${brand}, user=${user?.username} ===`);

  try {
    const result = await computeSync(brand, logFile);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error }, { status: 400 });
    }
    const ok = result as { success: true; dashboard_id: number; dashboard_name: string; changes: SyncChanges };
    return NextResponse.json({
      success: true,
      brand,
      dashboard_id: ok.dashboard_id,
      dashboard_name: ok.dashboard_name,
      changes: ok.changes,
    });
  } catch (err: any) {
    appendLog(logFile, `[${isoTs()}] ERROR: ${err.message}`);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
