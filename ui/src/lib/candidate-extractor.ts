/**
 * candidate-extractor.ts
 * 用途：从 bank_txn 字段提取 match_value 候选片段
 * 作者：Claude Code
 */

import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getDmSchema, normalizeBrand } from '@/lib/brand-server';

// 中文停用词表
const CHINESE_STOPWORDS = new Set([
  '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '那', '么', '她', '他', '它', '们', '把', '给', '从', '来', '为',
  '对', '但', '还', '能', '被', '让', '于', '与', '或', '而', '及', '以', '等',
  '已', '正在', '曾', '将', '可', '此', '其', '中', '后', '前', '所', '又', '之'
]);

// 数字相关模式（用于去噪声）
const NUMBER_PATTERNS = [
  /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/,  // 日期：2024-01-01, 2024年1月1日
  /\d{1,3}([,，]\d{3})+([.。]\d+)?/,  // 金额：1,234.56, 1，234.56
  /\d+([.。]\d+)?元/,                 // 金额：100元, 123.45元
  /\d+\.\d+/,                         // 小数
  /\d{8,}/,                           // 长数字序列
];

const DELIMITERS = /[,，\.。;；:：\s\n\r\t]+/;

function isNumberString(s: string): boolean {
  // 移除常见数字相关字符后检查
  const cleaned = s.replace(/[0-9０-９.．,，]/g, '');
  return cleaned.length === 0 || /^\d+$/.test(s);
}

function isNoise(text: string): boolean {
  // 检查是否匹配数字模式
  for (const pattern of NUMBER_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }

  // 检查是否为纯数字
  if (isNumberString(text)) {
    return true;
  }

  // 检查是否全为字母/数字混合（可能是账号等）
  if (/^[A-Za-z0-9]+$/.test(text)) {
    return true;
  }

  return false;
}

function tokenize(text: string): string[] {
  if (!text) return [];

  // 预处理：移除多余空白
  text = text.replace(/\s+/g, ' ').trim();

  // 切分
  const tokens = text.split(DELIMITERS);

  // 清理每个 token
  return tokens.map(t => t.trim()).filter(t => t.length > 0);
}

function filterCandidates(candidates: string[], minLength: number = 2): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    // 去重
    if (seen.has(candidate)) continue;

    // 长度过滤
    if (candidate.length < minLength) continue;

    // 纯数字过滤
    if (isNumberString(candidate)) continue;

    // 停用词过滤
    if (CHINESE_STOPWORDS.has(candidate)) continue;

    // 噪声过滤
    if (isNoise(candidate)) continue;

    seen.add(candidate);
    result.push(candidate);
  }

  return result;
}

function scoreCandidate(candidate: string): number {
  let score = 0;

  // 长度加分（太长或太短都减分）
  if (candidate.length >= 3 && candidate.length <= 6) {
    score += 2;
  } else if (candidate.length > 6) {
    score += 1;
  }

  // 包含数字但不是纯数字（可能是规格、型号）加分
  if (/\d/.test(candidate) && !isNumberString(candidate)) {
    score += 0.5;
  }

  // 中文优先
  if (/[\u4e00-\u9fff]/.test(candidate)) {
    score += 1;
  }

  return score;
}

export interface Candidate {
  candidate: string;
  score: number;
}

/**
 * 从银行流水的多个字段提取 match_value 候选
 */
export function extract_candidates_for_unclassified(
  data: {
    counterparty_name?: string;
    summary?: string;
    memo?: string;
    purpose?: string;
  },
  maxCandidates: number = 8
): Candidate[] {
  // 合并所有文本字段
  const allTexts = [
    data.counterparty_name || '',
    data.summary || '',
    data.memo || '',
    data.purpose || ''
  ];
  const combinedText = allTexts.filter(t => t).join(' ');

  // 分词
  const tokens = tokenize(combinedText);

  // 过滤
  const candidates = filterCandidates(tokens);

  // 评分并排序
  const scored: Candidate[] = candidates.map(candidate => ({
    candidate,
    score: scoreCandidate(candidate)
  }));

  // 按分数降序，截取前 maxCandidates 个
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxCandidates);
}

/**
 * 预览 match_value 的历史命中统计
 * 注意：这个函数在 API 路由中调用数据库
 */
export async function previewMatchValue(
  brand: string,
  matchValue: string,
  dmSchema: string
): Promise<{
  hitCount: number;
  totalAmt: number;
  primaryLvl1: string | null;
  primaryLvl2: string | null;
  lvl1Distribution: Record<string, number>;
}> {
  // 查询命中的流水
  const result = await pool.query(
    `
    SELECT
      c.lvl1,
      c.lvl2,
      COALESCE(t.in_amt, 0) + COALESCE(t.out_amt, 0) as amt
    FROM ${dmSchema}.v_bank_txn_classified c
    INNER JOIN yufeng_ods.bank_txn t ON c.bank_txn_id = t.id
    WHERE t.counterparty_name ILIKE '%' || $1 || '%'
       OR t.summary ILIKE '%' || $1 || '%'
       OR t.memo ILIKE '%' || $1 || '%'
       OR t.purpose ILKE '%' || $1 || '%'
    `,
    [matchValue]
  );

  // 汇总统计
  const hitCount = result.rows.length;
  const totalAmt = result.rows.reduce((sum, row) => sum + parseFloat(row.amt || '0'), 0);

  // lvl1 分布
  const lvl1Count: Record<string, number> = {};
  const lvl2Count: Record<string, number> = {};

  for (const row of result.rows) {
    const lvl1 = row.lvl1 || '未分类';
    const lvl2 = row.lvl2;

    lvl1Count[lvl1] = (lvl1Count[lvl1] || 0) + 1;

    if (lvl2) {
      lvl2Count[lvl2] = (lvl2Count[lvl2] || 0) + 1;
    }
  }

  // 找主要分类
  const primaryLvl1 = Object.entries(lvl1Count)
    .filter(([lvl]) => lvl !== '未分类')
    .sort(([, a], [, b]) => b - a)[0]?.[0] || null;

  const primaryLvl2 = Object.entries(lvl2Count)
    .sort(([, a], [, b]) => b - a)[0]?.[0] || null;

  return {
    hitCount,
    totalAmt: Math.round(totalAmt * 100) / 100,
    primaryLvl1,
    primaryLvl2,
    lvl1Distribution: lvl1Count
  };
}