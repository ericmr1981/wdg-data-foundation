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
  getBrandDashboardIds,
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
  const dashboardIds = getBrandDashboardIds(brand);

  if (!dashboardIds.length) {
    return {
      success: false,
      brand,
      error:
        `No dashboard IDs known for brand "${brand}". ` +
        `Set METABASE_DASHBOARDS_${brand.toUpperCase()}="4,5" (or METABASE_DASHBOARD_${brand.toUpperCase()}="9").`,
    };
  }

  const targetValues = await fetchDbStores(brand);

  const dashboards: any[] = [];

  for (const dashboardId of dashboardIds) {
    appendLog(logFile, `[${isoTs()}] Fetching dashboard ${dashboardId}…`);
    const dash = await getDashboard(dashboardId);
    const dashName: string = dash?.name ?? `dashboard-${dashboardId}`;
    const params: any[] = dash?.parameters ?? [];

    const found = findStoreCodeParam(params);
    if (!found) {
      appendLog(logFile, `[${isoTs()}] WARN: store_code parameter not found in dashboard ${dashboardId} (${dashName})`);
      dashboards.push({
        dashboard_id: dashboardId,
        dashboard_name: dashName,
        skipped: true,
        reason: 'store_code parameter not found',
      });
      continue;
    }

    const currentValues: [string, string][] = found.param.values_source_config?.values ?? [];

    const currentCodes = new Set(currentValues.map((v) => String(v[0])));
    const targetCodes = new Set(targetValues.map((v) => String(v[0])));

    const adds = targetValues.filter((v) => !currentCodes.has(String(v[0])));
    const removes = currentValues.filter((v) => !targetCodes.has(String(v[0])));

    appendLog(logFile, `[${isoTs()}] Dashboard ${dashboardId} current=${currentValues.length} target=${targetValues.length} adds=${adds.length} removes=${removes.length}`);

    dashboards.push({
      dashboard_id: dashboardId,
      dashboard_name: dashName,
      param_index: found.index,
      changes: { adds, removes, current: currentValues, target: targetValues },
    });
  }

  const active = dashboards.filter((d) => !d.skipped);
  if (!active.length) {
    return {
      success: false,
      brand,
      error: `All dashboards for brand "${brand}" were skipped (no store_code parameter found).`,
      dashboards,
    };
  }

  return { success: true, brand, dashboards };
}

// ── Apply: write to Metabase ──────────────────────────────────────────────────
async function applySync(dashboardId: number, targetValues: [string, string][], logFile: string) {
  appendLog(logFile, `[${isoTs()}] Fetching dashboard ${dashboardId} for apply…`);
  const dash = await getDashboard(dashboardId);
  const params: any[] = dash?.parameters ?? [];

  const found = findStoreCodeParam(params);
  if (!found) {
    appendLog(logFile, `[${isoTs()}] WARN: store_code param not found on apply, skip dashboard ${dashboardId}`);
    return { dashboard_id: dashboardId, skipped: true, reason: 'store_code parameter not found' };
  }

  const updatedParam = {
    ...found.param,
    values_source_type: 'static-list',
    values_source_config: { values: targetValues },
  };

  const nextParams = [...params];
  nextParams[found.index] = updatedParam;

  appendLog(logFile, `[${isoTs()}] PUT /api/dashboard/${dashboardId} …`);
  appendLog(
    logFile,
    `[${isoTs()}] Updated param: ${JSON.stringify({ id: updatedParam.id, slug: updatedParam.slug, value_count: targetValues.length })}`
  );

  await updateDashboardParameters(dashboardId, nextParams);
  appendLog(logFile, `[${isoTs()}] Done — ${targetValues.length} store values written.`);
  return { dashboard_id: dashboardId, applied: true, value_count: targetValues.length };
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
      return NextResponse.json({ success: false, error: (result as any).error }, { status: 400 });
    }

    const ok = result as { success: true; dashboards: any[] };

    if (dryRun) {
      appendLog(logFile, `[${isoTs()}] Dry-run complete — returning diff without applying.`);
      return NextResponse.json({
        success: true,
        dry_run: true,
        brand,
        dashboards: ok.dashboards,
        message: 'Dry-run complete. POST with dry_run=false to apply.',
      });
    }

    // Apply all dashboards
    const applied = [];
    for (const d of ok.dashboards) {
      if (d.skipped) continue;
      applied.push(await applySync(d.dashboard_id, d.changes.target, logFile));
    }

    return NextResponse.json({
      success: true,
      dry_run: false,
      brand,
      dashboards: ok.dashboards,
      applied: true,
      applied_dashboards: applied,
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
      return NextResponse.json({ success: false, error: (result as any).error }, { status: 400 });
    }
    const ok = result as { success: true; dashboards: any[] };
    return NextResponse.json({
      success: true,
      brand,
      dashboards: ok.dashboards,
    });
  } catch (err: any) {
    appendLog(logFile, `[${isoTs()}] ERROR: ${err.message}`);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
