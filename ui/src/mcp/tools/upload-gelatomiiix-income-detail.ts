import { z } from 'zod';
import { readFile } from 'fs/promises';

const UploadGelatomiiixIncomeInput = z.object({
  file_path: z.string().describe('Absolute path to the Qimai income detail CSV file (企迈 收入明细表 YYYY-MM-DD 至 YYYY-MM-DD.csv)'),
  store: z.string().optional().default('sh_xtd').describe('Store code, default sh_xtd'),
});

export const uploadGelatomiiixIncomeDetailTool = {
  name: 'upload_gelatomiiix_income_detail',
  description: `Upload a Qimai income detail CSV to the gelatomiiix_ods.income_detail table.

**Workflow**:
1. Call this tool with the file path
2. The tool reads the file and sends it to the upload API
3. Returns import stats including sourceFileId and row counts

**Expected filename format**: 企迈 收入明细表 YYYY-MM-DD 至 YYYY-MM-DD.csv

**Parameters**:
- file_path (required): absolute path to the CSV file
- store (optional): store code, default sh_xtd`,
  inputSchema: UploadGelatomiiixIncomeInput,
  async execute(params: z.infer<typeof UploadGelatomiiixIncomeInput>) {
    const { file_path, store } = params;
    const fileBuffer = await readFile(file_path);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const form = new FormData();
    const filename = file_path.split('/').pop() || 'income_detail.csv';
    form.append('file', new Blob([fileBuffer]), filename);
    form.append('store', store);

    const res = await fetch(`${baseUrl}/api/gelatomiiix/income/upload-qimai`, {
      method: 'POST',
      headers: { 'x-mcp-session': 'internal' },
      body: form,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`upload_gelatomiiix_income_detail failed: ${err}`);
    }

    const json = await res.json();
    const data = json.data ?? json;
    return {
      success: true,
      sourceFileId: data.sourceFileId ?? null,
      fileName: data.fileName ?? null,
      totalRows: data.totalRows ?? 0,
      insertedRows: data.insertedRows ?? 0,
      skipped: data.skipped ?? false,
    };
  },
};
