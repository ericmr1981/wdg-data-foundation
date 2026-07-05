import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { readFile } from 'fs/promises';

const UploadTamkokoIncomeDetailInput = z.object({
  file_path: z.string().describe('Absolute path to the Tamkoko Qimai income detail CSV file'),
  store: z.string().optional().default('hz_fuyang').describe('Store code, default hz_fuyang'),
});

export const uploadTamkokoIncomeDetailTool = {
  name: 'upload_tamkoko_income_detail',
  description: `Upload a Qimai income detail CSV to brand_tamkoko_ods.income_detail.

**Workflow**:
1. Call this tool with the file path
2. The tool reads the file and sends it to the upload API
3. Returns import stats including sourceFileId and row counts

**Parameters**:
- file_path (required): absolute path to the CSV file
- store (optional): store code, default hz_fuyang

**Response**: sourceFileId, fileName, totalRows, insertedRows, skipped flag`,
  inputSchema: UploadTamkokoIncomeDetailInput,
  async execute(params: z.infer<typeof UploadTamkokoIncomeDetailInput>) {
    const { file_path, store } = params;
    const fileBuffer = await readFile(file_path);
    const form = new FormData();
    const filename = file_path.split('/').pop() || 'income_detail.csv';
    form.append('file', new Blob([fileBuffer]), filename);
    form.append('store', store);

    const res = await mcpFetch(`/api/tamkoko/income/upload-qimai`, {
      method: 'POST',
      headers: { 'x-mcp-session': 'internal' },
      body: form,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`upload_tamkoko_income_detail failed: ${err}`);
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
