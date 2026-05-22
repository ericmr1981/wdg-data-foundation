import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCfgRuleTable, normalizeBrand } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';

const CSV_HEADERS = [
  'priority', 'direction', 'match_field', 'match_type', 'match_value',
  'match_field2', 'match_value2', 'lvl1_code', 'lvl2_code', 'note', 'enabled',
];

function escapeCSV(value: string | number | boolean | null): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCSV(values: (string | number | boolean | null)[]): string {
  return values.map(escapeCSV).join(',');
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const brandParam = searchParams.get('brand') || 'yufeng';
  const brand = normalizeBrand(brandParam);

  if (!brand) {
    return new NextResponse('Invalid brand', { status: 400 });
  }

  const user = await getSessionUser();
  try {
    assertRole(user, ['admin', 'operator']);
  } catch {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  const ruleTable = getCfgRuleTable(brand);

  try {
    const result = await pool.query(
      `
      SELECT
        priority, direction, match_field, match_type, match_value,
        match_field2, match_value2, lvl1_code, lvl2_code, note, enabled
      FROM ${ruleTable}
      ORDER BY priority ASC, rule_id ASC
      `
    );

    const lines: string[] = [rowToCSV(CSV_HEADERS)];
    for (const row of result.rows) {
      lines.push(rowToCSV([
        row.priority,
        row.direction,
        row.match_field,
        row.match_type,
        row.match_value,
        row.match_field2,
        row.match_value2,
        row.lvl1_code,
        row.lvl2_code,
        row.note,
        row.enabled ? 'true' : 'false',
      ]));
    }

    const csv = lines.join('\n');
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `${brand}_rules_${today}.csv`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    if (error?.code === '42P01') {
      const csv = rowToCSV(CSV_HEADERS);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${brand}_rules_empty.csv"`,
        },
      });
    }
    console.error('Error exporting rules:', error);
    return new NextResponse('Internal error', { status: 500 });
  }
}
