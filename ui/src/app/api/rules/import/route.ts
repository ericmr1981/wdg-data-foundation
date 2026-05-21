import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCfgRuleTable, normalizeBrand } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { Readable } from 'stream';
import csv from 'csv-parser';

const VALID_DIRECTIONS = new Set(['in', 'out', 'any']);
const VALID_MATCH_FIELDS = new Set(['summary', 'memo', 'purpose', 'counterparty_name']);
const VALID_MATCH_TYPES = new Set(['contains', 'exact']);

function makeError(rowIndex: number, message: string): string {
  return `第${rowIndex}行：${message}`;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);
  } catch {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const brandParam = formData.get('brand') as string | null;
    const file = formData.get('file') as File | null;

    if (!brandParam || !normalizeBrand(brandParam)) {
      return NextResponse.json({ success: false, error: 'Missing or invalid brand' }, { status: 400 });
    }
    if (!file) {
      return NextResponse.json({ success: false, error: 'Missing file' }, { status: 400 });
    }
    if (!file.name.endsWith('.csv')) {
      return NextResponse.json({ success: false, error: 'File must be .csv' }, { status: 400 });
    }

    const brand = normalizeBrand(brandParam)!;
    const ruleTable = getCfgRuleTable(brand);

    const text = await file.text();
    const records: string[][] = [];

    await new Promise<void>((resolve, reject) => {
      const readable = Readable.from([text]);
      readable
        .pipe(csv({ skipLines: 0 }))
        .on('data', (row: any) => records.push(Object.values(row)))
        .on('error', reject)
        .on('end', resolve);
    });

    if (records.length === 0) {
      return NextResponse.json({ success: false, error: 'Empty CSV' }, { status: 400 });
    }

    const headerRow = records[0];
    const headerMap: Record<string, number> = {};
    headerRow.forEach((col, i) => {
      headerMap[col.trim()] = i;
    });

    const required = ['priority', 'direction', 'match_field', 'match_type', 'match_value', 'lvl1_code'];
    for (const col of required) {
      if (headerMap[col] === undefined) {
        return NextResponse.json(
          { success: false, error: `CSV 缺少必填列: ${col}` },
          { status: 400 }
        );
      }
    }

    const existing = await pool.query(
      `SELECT direction, match_field, match_type, match_value, lvl1_code FROM ${ruleTable}`
    );
    const existingSet = new Set(
      existing.rows.map(r =>
        `${r.direction}|${r.match_field}|${r.match_type}|${r.match_value}|${r.lvl1_code}`
      )
    );

    const maxP = await pool.query(`SELECT COALESCE(MAX(priority), 0) as m FROM ${ruleTable}`);
    let nextPriority = (maxP.rows[0]?.m ?? 0) + 1;

    const client = await pool.connect();
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];

    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('wdg.user', $1, true)", [user?.username || 'unknown']);

      for (let i = 1; i < records.length; i++) {
        const row = records[i];
        const rowNum = i + 1;

        const direction = (row[headerMap.direction] ?? '').trim().toLowerCase();
        const match_field = (row[headerMap.match_field] ?? '').trim();
        const match_type = (row[headerMap.match_type] ?? '').trim().toLowerCase();
        const match_value = (row[headerMap.match_value] ?? '').trim();
        const match_field2 = (row[headerMap.match_field2] ?? '').trim() || null;
        const match_value2 = (row[headerMap.match_value2] ?? '').trim() || null;
        const lvl1_code = (row[headerMap.lvl1_code] ?? '').trim();
        const lvl2_code = (row[headerMap.lvl2_code] ?? '').trim() || null;
        const note = (row[headerMap.note] ?? '').trim() || null;
        const enabled = (row[headerMap.enabled] ?? '').trim().toLowerCase() !== 'false';

        if (!direction || !VALID_DIRECTIONS.has(direction)) {
          errors.push(makeError(rowNum, `direction 值无效: ${direction}`));
          skipped++;
          continue;
        }
        if (!match_field || !VALID_MATCH_FIELDS.has(match_field)) {
          errors.push(makeError(rowNum, `match_field 值无效: ${match_field}`));
          skipped++;
          continue;
        }
        if (!match_type || !VALID_MATCH_TYPES.has(match_type)) {
          errors.push(makeError(rowNum, `match_type 值无效: ${match_type}`));
          skipped++;
          continue;
        }
        if (!match_value) {
          errors.push(makeError(rowNum, `match_value 为空`));
          skipped++;
          continue;
        }
        if (!lvl1_code) {
          errors.push(makeError(rowNum, `lvl1_code 为空`));
          skipped++;
          continue;
        }

        const key = `${direction}|${match_field}|${match_type}|${match_value}|${lvl1_code}`;
        if (existingSet.has(key)) {
          skipped++;
          continue;
        }

        await client.query(
          `
          INSERT INTO ${ruleTable} (
            priority, direction, match_field, match_type, match_value,
            match_field2, match_value2, lvl1_code, lvl2_code, note, enabled
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `,
          [nextPriority++, direction, match_field, match_type, match_value,
           match_field2, match_value2, lvl1_code, lvl2_code, note, enabled]
        );

        existingSet.add(key);
        imported++;
      }

      await client.query('COMMIT');
      return NextResponse.json({ success: true, imported, skipped, errors });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error: any) {
    console.error('Error importing rules:', error);
    return NextResponse.json({ success: false, error: 'Import failed' }, { status: 500 });
  }
}
