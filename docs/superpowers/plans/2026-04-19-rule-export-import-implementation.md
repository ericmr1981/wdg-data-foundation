# 规则导出导入功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在规则管理页面增加导出/导入 CSV 功能，支持品牌规则备份和迁移。

**Architecture:** 两个新 API Route + 页面 UI 修改。导出返回 CSV 文件流，导入解析 CSV 并追加规则到数据库。结果弹窗展示导入统计。

**Tech Stack:** Next.js 14 App Router, Node.js `csv-parse`（内置）, pg

---

## 文件结构

```
ui/src/app/
├── api/rules/
│   ├── export/route.ts   # 新建 - GET 导出 CSV
│   └── import/route.ts   # 新建 - POST 导入 CSV
└── rules/page.tsx        # 修改 - 增加导出/导入按钮 + 结果弹窗
```

---

## Task 1: 创建导出 API (`GET /api/rules/export`)

**Files:**
- Create: `ui/src/app/api/rules/export/route.ts`

- [ ] **Step 1: 创建目录**

```bash
mkdir -p ui/src/app/api/rules/export
```

- [ ] **Step 2: 编写导出 API**

```typescript
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
      // 表不存在，返回仅表头的空 CSV
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
```

Save to `ui/src/app/api/rules/export/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add ui/src/app/api/rules/export/route.ts
git commit -m "feat(api): add GET /api/rules/export for CSV download"
```

---

## Task 2: 创建导入 API (`POST /api/rules/import`)

**Files:**
- Create: `ui/src/app/api/rules/import/route.ts`

- [ ] **Step 1: 创建目录**

```bash
mkdir -p ui/src/app/api/rules/import
```

- [ ] **Step 2: 编写导入 API**

Next.js 内置了 `csv-parse`（通过 `node:csv-parse`）。使用 Node.js 内置方式解析：

```typescript
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCfgRuleTable, normalizeBrand } from '@/lib/brand-server';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { parse } from 'csv-parse';

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
      parse(text, { skip_empty_lines: true })
        .on('data', (row: string[]) => records.push(row))
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

    // 检查必填列
    const required = ['priority', 'direction', 'match_field', 'match_type', 'match_value', 'lvl1_code'];
    for (const col of required) {
      if (headerMap[col] === undefined) {
        return NextResponse.json(
          { success: false, error: `CSV 缺少必填列: ${col}` },
          { status: 400 }
        );
      }
    }

    // 获取已有规则用于重复检测
    const existing = await pool.query(
      `SELECT direction, match_field, match_type, match_value, lvl1_code FROM ${ruleTable}`
    );
    const existingSet = new Set(
      existing.rows.map(r =>
        `${r.direction}|${r.match_field}|${r.match_type}|${r.match_value}|${r.lvl1_code}`
      )
    );

    // 获取当前最大 priority
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

        const priority = parseInt(headerMap.priority !== undefined ? (row[headerMap.priority] ?? '') : '', 10);
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

        // 字段校验
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

        // 重复检测
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
```

Save to `ui/src/app/api/rules/import/route.ts`.

- [ ] **Step 3: Commit**

```bash
git add ui/src/app/api/rules/import/route.ts
git commit -m "feat(api): add POST /api/rules/import for CSV upload"
```

---

## Task 3: 修改规则管理页面 UI

**Files:**
- Modify: `ui/src/app/rules/page.tsx` (在工具栏增加导出按钮，在导入部分增加结果弹窗)

### 修改点 1：在工具栏增加导出按钮

在"导入规则"按钮后增加"导出规则"按钮。

在 `ui/src/app/rules/page.tsx` 的第 560-568 行附近（导入规则按钮后），添加：

```tsx
<button
  onClick={async () => {
    window.location.href = `/api/rules/export?brand=${encodeURIComponent(brand)}`;
  }}
  className="px-3 py-2 border rounded-lg bg-white hover:bg-gray-50"
>
  导出规则
</button>
```

### 修改点 2：增加导入结果弹窗 state

在 `rules/page.tsx` 的 `useState` 区域，增加：

```typescript
const [importResult, setImportResult] = useState<{
  imported: number;
  skipped: number;
  errors: string[];
} | null>(null);
```

### 修改点 3：修改导入按钮逻辑（替换现有的 setShowImportModal）

将现有的"导入规则"按钮 onClick 改为：
1. 打开隐藏的 file input
2. 上传后调用 API
3. 显示结果弹窗

在文件顶部增加 ref：
```typescript
const fileInputRef = useRef<HTMLInputElement>(null);
```

在 JSX 中增加隐藏的 file input（放在 form 外）：
```tsx
<input
  ref={fileInputRef}
  type="file"
  accept=".csv"
  className="hidden"
  onChange={async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const fd = new FormData();
    fd.append('brand', brand);
    fd.append('file', file);

    let data;
    try {
      const res = await fetch('/api/rules/import', { method: 'POST', body: fd });
      data = await res.json();
    } catch {
      setImportResult({ imported: 0, skipped: 0, errors: ['网络错误，请重试'] });
      return;
    }

    setImportResult(data);
    if (data.success) {
      // 刷新规则列表
      loadRules();
    }
  }}
/>
```

将"导入规则"按钮 onClick 改为：
```tsx
<button
  onClick={() => {
    fileInputRef.current?.click();
  }}
  className="px-3 py-2 border rounded-lg bg-white hover:bg-gray-50"
>
  导入规则
</button>
```

### 修改点 4：增加结果弹窗

在页面 JSX 中，在 `{/* 重跑匹配模块 */}` 块之前（或在任何合适位置），添加：

```tsx
{importResult !== null && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="bg-white rounded-lg p-6 max-w-md w-full">
      <h2 className="text-lg font-semibold mb-4">导入完成</h2>
      <div className="space-y-2 text-sm">
        <p>成功 <span className="font-medium text-green-600">{importResult.imported}</span> 条</p>
        <p>跳过 <span className="font-medium text-yellow-600">{importResult.skipped}</span> 条</p>
        {importResult.errors.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-red-600 text-xs">
              查看错误详情 ({importResult.errors.length} 条)
            </summary>
            <ul className="mt-1 text-xs text-red-500 list-disc list-inside max-h-40 overflow-y-auto">
              {importResult.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <div className="mt-6 flex justify-end">
        <button
          onClick={() => setImportResult(null)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          确定
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 1: 修改 rules/page.tsx**

Read the full file first, then apply all 4 modifications above.

- [ ] **Step 2: Commit**

```bash
git add ui/src/app/rules/page.tsx
git commit -m "feat(rules): add export/import CSV buttons and result modal"
```

---

## 实现顺序

| Task | 内容 | 依赖 |
|------|------|------|
| Task 1 | 导出 API | 无 |
| Task 2 | 导入 API | 无 |
| Task 3 | 页面 UI | Task 1 + Task 2 |

---

## 验证步骤

1. 启动 `npm run dev`
2. 登录，进入规则管理页面
3. 点击"导出规则" → 应下载 CSV 文件
4. 准备一个测试 CSV 文件，点击"导入规则" → 上传文件 → 弹窗显示结果
5. 检查规则列表是否刷新
