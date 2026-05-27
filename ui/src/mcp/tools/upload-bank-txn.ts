import { z } from 'zod';

const UploadBankTxnInput = z.object({
  brand:     z.string().describe('Brand code: yufeng | gelatomiiix | bonjur'),
  store:     z.string().describe('Store code (e.g. wz_wxc for 温州万象城, wz_ra for 瑞安吾悦广场)'),
  file_path: z.string().describe('Absolute path to the bank statement Excel file (.xlsx)'),
});

export const uploadBankTxnTool = {
  name: 'upload_bank_txn_file',
  description: `Upload a bank statement Excel file, trigger import pipeline, and return coverage stats.

**Workflow after upload**:
1. Upload the file → get back sourceFileId
2. Check coverage: if unclassifiedThisFile > 0, call get_unclassified_transactions(source_file_id=<sourceFileId>) to get the exact list
3. Call get_existing_rules to understand current classification patterns
4. LLM reasoning → submit_approval_proposal for each unclassified txn

**Key response fields**:
- sourceFileId: use this as source_file_id in subsequent get_unclassified_transactions call
- unclassifiedThisFile: how many records in THIS upload file need classification
- unclassifiedThisBrandMonth: total unclassified for this brand+month (may include historical leftovers)
- coveragePct: brand+month overall coverage percentage

**Parameters (all required)**:
- brand: brand code
- store: store code
- file_path: absolute path to .xlsx file`,
  inputSchema: UploadBankTxnInput,
  async execute({ brand, store, file_path }: z.infer<typeof UploadBankTxnInput>) {
    const { readFile } = await import('fs/promises');
    const fileBuffer = await readFile(file_path);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const form = new FormData();
    const filename = file_path.split('/').pop() || 'bank_statement.xlsx';
    form.append('file', new Blob([fileBuffer]), filename);
    form.append('brand', brand);
    form.append('store', store);
    form.append('source', 'bank');
    form.append('triggerImport', 'true');
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { 'x-mcp-session': 'internal' },
      body: form,
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Upload failed: ${err}`);
    }
    const json = await res.json();
    // Normalize field names for MCP consumption
    const data = json.data ?? json;
    return {
      success: true,
      sourceFileId: data.sourceFileId ?? data.source_file_id ?? null,
      fileName: data.fileName ?? data.file_name ?? null,
      rowCount: data.rowCount ?? data.row_count ?? null,
      unclassifiedThisFile: data.unclassifiedThisFile ?? data.unclassified_this_file ?? null,
      unclassifiedThisBrandMonth: data.unclassifiedThisBrandMonth ?? data.unclassified_this_brand_month ?? null,
      totalThisBrandMonth: data.totalThisBrandMonth ?? data.total_this_brand_month ?? null,
      coveragePct: data.coveragePct ?? data.coverage_pct ?? null,
      importError: data.importError ?? data.import_error ?? null,
    };
  },
};