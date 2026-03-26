'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useBrand } from '@/lib/brand-context';
import { getCfgSchema, getDmSchema, getOdsSchema } from '@/lib/brand-server';
import { getLineageGraph, type LineageNode } from '@/lib/lineage-manifest';

type PipelineStepRun = {
  step_id: number;
  run_id: string;
  step_name: string;
  step_order: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  rows_in: number | null;
  rows_out: number | null;
  rows_rejected: number;
  duration_sec: number | null;
  error_message: string | null;
};

type PipelineRun = {
  run_id: string;
  brand_code: string;
  store_code: string | null;
  started_at: string;
  finished_at: string | null;
  status: string;
  triggered_by: string;
  month: string | null;
  note: string | null;
  steps?: PipelineStepRun[];
};

type DbSchemaRow = { schema_name: string };
type DbObjectRow = { name: string; kind: 'table' | 'view' };
type DbColumnRow = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  ordinal_position: number;
};

type DbObjectDetail = {
  schema: string;
  name: string;
  columns: DbColumnRow[];
  approx_rows: number | null;
};

function classNames(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(' ');
}

export default function LineagePage() {
  const router = useRouter();
  const { brand } = useBrand();
  const graph = useMemo(() => getLineageGraph(brand), [brand]);

  const [me, setMe] = useState<{ username: string; role: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [schemas, setSchemas] = useState<DbSchemaRow[]>([]);
  const [schema, setSchema] = useState<string>('');
  const [objects, setObjects] = useState<DbObjectRow[]>([]);
  const [objectName, setObjectName] = useState<string>('');
  const [detail, setDetail] = useState<DbObjectDetail | null>(null);

  // Pipeline playback (admin-only page, but pipeline API itself supports operator too)
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [runId, setRunId] = useState<string>('');

  const [selectedNodeId, setSelectedNodeId] = useState<string>(graph.nodes[0]?.id || '');
  const selectedNode: LineageNode | null = useMemo(
    () => graph.nodes.find((n) => n.id === selectedNodeId) || null,
    [graph.nodes, selectedNodeId]
  );

  // auth/me (admin-only page)
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) return null;
        return r.json();
      })
      .then((d) => {
        if (d?.success) {
          setMe(d.data);
        } else {
          setMe(null);
        }
      })
      .catch(() => {
        setMe(null);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  // Load schemas (admin only)
  useEffect(() => {
    if (!authChecked) return;
    if (me?.role !== 'admin') return;

    async function loadSchemas() {
      const res = await fetch('/api/db/introspect', { cache: 'no-store' });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      const data = await res.json();
      if (data?.success) {
        setSchemas(data.data || []);

        // pick a sensible default schema for the current brand
        const ods = getOdsSchema(brand);
        const cfg = getCfgSchema(brand);
        const dm = getDmSchema(brand);
        const preferred = [dm, cfg, ods, 'raw', 'ops'];

        const found = preferred.find((s) => (data.data || []).some((r: any) => r.schema_name === s));
        setSchema(found || (data.data?.[0]?.schema_name ?? ''));
      }
    }

    loadSchemas().catch(() => {});
  }, [brand, authChecked, me?.role, router]);

  // Load recent pipeline runs (for playback)
  useEffect(() => {
    if (!authChecked) return;
    if (me?.role !== 'admin') return;

    async function loadRuns() {
      const res = await fetch('/api/pipeline', { cache: 'no-store' });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      const data = await res.json();
      if (data?.success) {
        const rows: PipelineRun[] = data.data || [];
        setRuns(rows);
        const firstForBrand = rows.find((r) => r.brand_code === brand);
        setRunId(firstForBrand?.run_id || rows?.[0]?.run_id || '');
      }
    }

    loadRuns().catch(() => {});
  }, [brand, authChecked, me?.role, router]);

  // Load objects for schema
  useEffect(() => {
    if (!schema) return;
    async function loadObjects() {
      setObjects([]);
      setObjectName('');
      setDetail(null);

      const res = await fetch(`/api/db/introspect?schema=${encodeURIComponent(schema)}`, { cache: 'no-store' });
      const data = await res.json();
      if (data?.success) {
        setObjects(data.data || []);
      }
    }

    loadObjects().catch(() => {});
  }, [schema]);

  // Load columns for object
  useEffect(() => {
    if (!schema || !objectName) return;
    async function loadDetail() {
      setDetail(null);
      const res = await fetch(
        `/api/db/introspect?schema=${encodeURIComponent(schema)}&name=${encodeURIComponent(objectName)}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (data?.success) setDetail(data.data);
    }

    loadDetail().catch(() => {});
  }, [schema, objectName]);

  if (!authChecked) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  const isAdmin = me?.role === 'admin';
  if (!isAdmin) {
    // If not logged in, send to login; if logged in but role mismatch, show forbidden.
    if (!me) {
      router.replace('/login');
      return null;
    }

    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        Forbidden：该页面仅 admin 可访问。
      </div>
    );
  }

  const runOptions = runs
    .filter((r) => r.brand_code === brand)
    .concat(runs.filter((r) => r.brand_code !== brand));

  const selectedRun = runOptions.find((r) => r.run_id === runId) || null;

  // Step mapping (pipeline_step_run.step_name -> lineage node id)
  const stepToNode: Record<string, string> = {
    run_import_yufeng: 'raw_ingest_file',
    run_import_bonjur: 'raw_ingest_file',
    apply_classification_sql: 'apply_sql',
    apply_coverage_sql: 'dm_views',
    print_summary: 'ui_pipeline',
  };

  function normalizeStepStatus(s: string | null | undefined) {
    const v = String(s || '').toLowerCase();
    if (v.includes('fail')) return 'failed';
    if (v.includes('error')) return 'failed';
    if (v.includes('running')) return 'running';
    if (v.includes('success')) return 'success';
    if (v.includes('done')) return 'success';
    return v || 'unknown';
  }

  const nodeStatus = useMemo(() => {
    const m = new Map<string, { status: string; label?: string }>();
    if (!selectedRun?.steps?.length) return m;

    for (const st of selectedRun.steps) {
      const nodeId = stepToNode[st.step_name];
      if (!nodeId) continue;
      const status = normalizeStepStatus(st.status);
      const prev = m.get(nodeId);

      // failed > running > success > unknown
      const rank = (x: string) => (x === 'failed' ? 3 : x === 'running' ? 2 : x === 'success' ? 1 : 0);
      if (!prev || rank(status) > rank(prev.status)) {
        m.set(nodeId, {
          status,
          label: st.duration_sec != null ? `${Math.round(st.duration_sec)}s` : undefined,
        });
      }
    }

    return m;
  }, [selectedRun?.run_id]);

  function statusColor(status: string) {
    if (status === 'success') return { stroke: '#16a34a', fill: '#dcfce7', text: '#14532d' };
    if (status === 'failed') return { stroke: '#dc2626', fill: '#fee2e2', text: '#7f1d1d' };
    if (status === 'running') return { stroke: '#d97706', fill: '#ffedd5', text: '#7c2d12' };
    return { stroke: '#e2e8f0', fill: 'white', text: '#0f172a' };
  }

  // --- simple SVG graph layout ---
  const laneCount = Math.max(1, ...graph.nodes.map((n) => n.lane + 1));
  const laneWidth = 220;
  const nodeW = 200;
  const nodeH = 58;
  const gapY = 26;
  const padX = 20;
  const padY = 20;

  const nodesWithPos = graph.nodes.map((n) => {
    const x = padX + n.lane * laneWidth;
    const y = padY + n.order * (nodeH + gapY);
    return { ...n, x, y };
  });

  const nodeById = new Map(nodesWithPos.map((n) => [n.id, n] as const));

  const svgW = padX * 2 + laneWidth * laneCount;
  const svgH = Math.max(
    260,
    padY * 2 +
      Math.max(
        ...nodesWithPos.map((n) => n.y + nodeH)
      )
  );

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">数据流地图（Engineering / Tech）</h1>
          <div className="text-sm text-gray-500">brand: {brand}</div>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-xs text-gray-500">Playback:</div>
          <select
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white max-w-[440px]"
          >
            {runOptions.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.started_at?.slice(0, 19).replace('T', ' ')} · {r.brand_code}{r.store_code ? `/${r.store_code}` : ''} · {r.status} · {r.run_id.slice(0, 8)}
              </option>
            ))}
          </select>

          <div className="text-xs text-gray-500">
            点击节点查看说明；下方可浏览 DB schema/table/column。
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white border rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-gray-900">Data Flow</div>
            {selectedNode && (
              <div className="text-xs text-gray-500">Selected: {selectedNode.title}</div>
            )}
          </div>

          <div className="overflow-auto border rounded bg-gray-50">
            <svg width={svgW} height={svgH} className="block">
              <defs>
                <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L9,3 z" fill="#94a3b8" />
                </marker>
              </defs>

              {/* edges */}
              {graph.edges.map((e, idx) => {
                const a = nodeById.get(e.from);
                const b = nodeById.get(e.to);
                if (!a || !b) return null;

                const aSt = nodeStatus.get(e.from)?.status || 'unknown';
                const bSt = nodeStatus.get(e.to)?.status || 'unknown';
                const edgeEmph = aSt === 'failed' || bSt === 'failed' || aSt === 'running' || bSt === 'running';

                const x1 = a.x + nodeW;
                const y1 = a.y + nodeH / 2;
                const x2 = b.x;
                const y2 = b.y + nodeH / 2;
                const mx = (x1 + x2) / 2;
                const path = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
                return (
                  <g key={idx}>
                    <path
                      d={path}
                      stroke={edgeEmph ? '#334155' : '#94a3b8'}
                      strokeWidth={edgeEmph ? 2.2 : 1.5}
                      fill="none"
                      markerEnd="url(#arrow)"
                      opacity={edgeEmph ? 1 : 0.9}
                    />
                    {e.label && (
                      <text x={mx} y={(y1 + y2) / 2 - 6} fontSize="10" fill="#64748b" textAnchor="middle">
                        {e.label}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* nodes */}
              {nodesWithPos.map((n) => {
                const selected = n.id === selectedNodeId;
                const st = nodeStatus.get(n.id)?.status || 'unknown';
                const badge = nodeStatus.get(n.id)?.label;
                const c = statusColor(st);

                const fill = selected ? '#dbeafe' : c.fill;
                const stroke = selected ? '#2563eb' : c.stroke;
                const strokeW = selected ? 2.4 : st === 'unknown' ? 1 : 2;

                return (
                  <g
                    key={n.id}
                    onClick={() => setSelectedNodeId(n.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect
                      x={n.x}
                      y={n.y}
                      width={nodeW}
                      height={nodeH}
                      rx={10}
                      fill={fill}
                      stroke={stroke}
                      strokeWidth={strokeW}
                    />

                    {/* status dot */}
                    <circle cx={n.x + nodeW - 14} cy={n.y + 14} r={6} fill={stroke} opacity={st === 'unknown' ? 0.25 : 0.9} />

                    <text x={n.x + 12} y={n.y + 22} fontSize="12" fill={c.text} fontWeight={700}>
                      {n.title}
                    </text>
                    {n.subtitle && (
                      <text x={n.x + 12} y={n.y + 40} fontSize="10" fill="#475569">
                        {n.subtitle}
                      </text>
                    )}

                    {badge && (
                      <text x={n.x + nodeW - 16} y={n.y + 40} fontSize="9" fill="#0f172a" textAnchor="end" opacity={0.75}>
                        {badge}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        <div className="bg-white border rounded-lg shadow-sm p-4">
          <div className="text-sm font-medium text-gray-900 mb-2">节点说明 / Playback</div>
          {selectedNode ? (
            <div className="space-y-3">
              <div>
                <div className="text-sm font-semibold text-gray-900">{selectedNode.title}</div>
                {selectedNode.subtitle && <div className="text-xs text-gray-500">{selectedNode.subtitle}</div>}
              </div>

              {selectedNode.description && (
                <div className="text-sm text-gray-700 leading-relaxed">{selectedNode.description}</div>
              )}

              {selectedNode.ref?.kind && (
                <div className="text-xs text-gray-600">
                  <div className="font-medium text-gray-700">Ref</div>
                  <div className="mt-1 font-mono">
                    {selectedNode.ref.kind === 'table' || selectedNode.ref.kind === 'view'
                      ? `${selectedNode.ref.schema}.${selectedNode.ref.name}`
                      : selectedNode.ref.path || selectedNode.ref.kind}
                  </div>
                </div>
              )}

              {selectedRun && (
                <div className="text-xs text-gray-600 border-t pt-3">
                  <div className="font-medium text-gray-700">Selected run</div>
                  <div className="mt-1 font-mono">{selectedRun.run_id}</div>
                  <div className="mt-1 text-gray-500">
                    {selectedRun.started_at?.slice(0, 19).replace('T', ' ')} → {selectedRun.finished_at ? selectedRun.finished_at.slice(0, 19).replace('T', ' ') : '...'} · status: {selectedRun.status}
                  </div>
                </div>
              )}

              {selectedNode.ref?.kind === 'table' && selectedNode.ref.schema && selectedNode.ref.name && (
                <button
                  className="text-xs border rounded px-2 py-1 bg-white hover:bg-gray-50"
                  onClick={() => {
                    setSchema(selectedNode.ref!.schema!);
                    setObjectName(selectedNode.ref!.name!);
                  }}
                >
                  在下方 Schema Explorer 打开
                </button>
              )}

              {selectedRun?.steps?.length ? (
                <div className="text-xs text-gray-600 border-t pt-3">
                  <div className="font-medium text-gray-700">Steps</div>
                  <div className="mt-2 space-y-1 max-h-44 overflow-auto">
                    {selectedRun.steps.map((s) => (
                      <div key={s.step_id} className="flex items-center justify-between gap-2">
                        <div className="font-mono text-[11px] text-gray-700">{s.step_order}. {s.step_name}</div>
                        <div className="text-[11px] text-gray-500">
                          {s.status}{s.duration_sec != null ? ` · ${Math.round(s.duration_sec)}s` : ''}{s.rows_out != null ? ` · rows_out=${s.rows_out}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="text-sm text-gray-500">请选择一个节点</div>
          )}
        </div>
      </div>

      <div className="bg-white border rounded-lg shadow-sm p-4">
        <div className="flex items-end justify-between gap-4 mb-3">
          <div>
            <div className="text-sm font-medium text-gray-900">Schema Explorer</div>
            <div className="text-xs text-gray-500">Admin-only · information_schema / pg_catalog (approx rows)</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="space-y-2">
            <div className="text-xs text-gray-500">Schema</div>
            <select
              value={schema}
              onChange={(e) => setSchema(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded px-2 py-2 bg-white"
            >
              {schemas.map((s) => (
                <option key={s.schema_name} value={s.schema_name}>
                  {s.schema_name}
                </option>
              ))}
            </select>

            <div className="text-xs text-gray-500 pt-2">Objects</div>
            <div className="border rounded max-h-72 overflow-auto">
              {objects.length === 0 ? (
                <div className="p-3 text-sm text-gray-500">（空）</div>
              ) : (
                objects.map((o) => (
                  <button
                    key={o.kind + ':' + o.name}
                    onClick={() => setObjectName(o.name)}
                    className={classNames(
                      'w-full text-left px-3 py-2 text-sm border-b last:border-b-0 hover:bg-gray-50',
                      objectName === o.name && 'bg-blue-50'
                    )}
                  >
                    <span className="text-xs text-gray-500 mr-2">{o.kind}</span>
                    <span className="font-mono">{o.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="text-xs text-gray-500">Detail</div>
            <div className="border rounded p-3">
              {!objectName ? (
                <div className="text-sm text-gray-500">选择一个 table/view 查看列结构。</div>
              ) : !detail ? (
                <div className="text-sm text-gray-500">加载中...</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-sm text-gray-900">
                      {detail.schema}.{detail.name}
                    </div>
                    <div className="text-xs text-gray-500">approx rows: {detail.approx_rows ?? 'n/a'}</div>
                  </div>

                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-xs text-gray-500 border-b">
                          <th className="text-left py-2 pr-4">#</th>
                          <th className="text-left py-2 pr-4">column</th>
                          <th className="text-left py-2 pr-4">type</th>
                          <th className="text-left py-2 pr-4">nullable</th>
                          <th className="text-left py-2 pr-4">default</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.columns.map((c) => (
                          <tr key={c.ordinal_position} className="border-b last:border-b-0">
                            <td className="py-2 pr-4 text-gray-500">{c.ordinal_position}</td>
                            <td className="py-2 pr-4 font-mono">{c.column_name}</td>
                            <td className="py-2 pr-4 font-mono text-gray-700">{c.data_type}</td>
                            <td className="py-2 pr-4 text-gray-700">{c.is_nullable}</td>
                            <td className="py-2 pr-4 font-mono text-gray-600">{c.column_default || ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="text-xs text-gray-500">
                    常用：<span className="font-mono">SELECT * FROM {detail.schema}.{detail.name} LIMIT 50;</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
