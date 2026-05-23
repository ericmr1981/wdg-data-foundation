import { getCfgSchema, getDmSchema, getOdsSchema } from '@/lib/brand-schema';

export type LineageObjectRef = {
  kind: 'table' | 'view' | 'function' | 'script' | 'ui' | 'concept';
  // For table/view
  schema?: string;
  name?: string;
  // For scripts/ui
  path?: string;
};

export type LineageNode = {
  id: string;
  title: string;
  subtitle?: string;
  ref?: LineageObjectRef;
  description?: string;
  lane: number; // 0..N columns
  order: number; // vertical order within lane
};

export type LineageEdge = {
  from: string;
  to: string;
  label?: string;
};

export type LineageGraph = {
  nodes: LineageNode[];
  edges: LineageEdge[];
};

/**
 * V1: config-driven lineage graph.
 * - Engineering-focused, DB-first.
 * - Brand-aware schema mapping via brand-server helpers.
 */
export function getLineageGraph(brand: string): LineageGraph {
  const ods = getOdsSchema(brand);
  const cfg = getCfgSchema(brand);
  const dm = getDmSchema(brand);

  const nodes: LineageNode[] = [
    {
      id: 'ui_upload',
      title: 'UI: 文件上传',
      subtitle: '/upload',
      ref: { kind: 'ui', path: '/upload' },
      description: '管理端上传源文件到 inputs/，并触发导入脚本。',
      lane: 0,
      order: 0,
    },
    {
      id: 'raw_ingest_file',
      title: 'raw.ingest_file',
      subtitle: '导入登记表',
      ref: { kind: 'table', schema: 'raw', name: 'ingest_file' },
      description: '记录每次导入文件、品牌/门店、月份、状态、路径等。',
      lane: 1,
      order: 0,
    },
    {
      id: 'ods',
      title: `${ods}.bank_txn / sales_*`,
      subtitle: 'ODS 明细层',
      ref: { kind: 'concept' },
      description: '按品牌落到 ODS 明细表（例如 bank_txn 或 sales_monthly）。',
      lane: 2,
      order: 0,
    },
    {
      id: 'cfg_rules',
      title: `${cfg}.bank_rule_map`,
      subtitle: '规则配置表',
      ref: { kind: 'table', schema: cfg, name: 'bank_rule_map' },
      description: '规则管理页维护的规则最终沉淀在此表（支持分组、优先级、双条件等）。',
      lane: 2,
      order: 1,
    },
    {
      id: 'apply_sql',
      title: 'Apply Classification SQL',
      subtitle: '分类落库/视图刷新',
      ref: { kind: 'script', path: '/Users/ericmr/Documents/GitHub/wdg-data-foundation/sql/*_apply_classification.sql' },
      description: '把规则应用到明细（含 override），并生成后续 DM 所需视图。',
      lane: 3,
      order: 0,
    },
    {
      id: 'dm_views',
      title: `${dm}.*`,
      subtitle: 'DM/报表视图层',
      ref: { kind: 'concept' },
      description: '例如 v_coverage_monthly、revenue_monthly、expense_monthly、profit_monthly 等。',
      lane: 4,
      order: 0,
    },
    {
      id: 'ui_pipeline',
      title: 'UI: Pipeline 监控',
      subtitle: '/pipeline',
      ref: { kind: 'ui', path: '/pipeline' },
      description: '查看 pipeline_run/step_run、覆盖率、未分类 Top。',
      lane: 5,
      order: 0,
    },
    {
      id: 'ui_rules',
      title: 'UI: 规则管理',
      subtitle: '/rules',
      ref: { kind: 'ui', path: '/rules' },
      description: '维护 bank_rule_map 规则，并提供命中预览/回滚等管理动作。',
      lane: 5,
      order: 1,
    },
    {
      id: 'ui_match',
      title: 'UI: 人工匹配',
      subtitle: '/match',
      ref: { kind: 'ui', path: '/match' },
      description: '对未分类交易进行人工沉淀（override），提高覆盖率。',
      lane: 5,
      order: 2,
    },
  ];

  const edges: LineageEdge[] = [
    { from: 'ui_upload', to: 'raw_ingest_file', label: 'import登记' },
    { from: 'raw_ingest_file', to: 'ods', label: '导入落库' },
    { from: 'cfg_rules', to: 'apply_sql', label: '规则输入' },
    { from: 'ods', to: 'apply_sql', label: '明细输入' },
    { from: 'apply_sql', to: 'dm_views', label: '视图/模型' },
    { from: 'dm_views', to: 'ui_pipeline', label: '指标/KPI' },
    { from: 'cfg_rules', to: 'ui_rules', label: 'CRUD' },
    { from: 'ods', to: 'ui_match', label: '候选/未分类' },
  ];

  return { nodes, edges };
}
