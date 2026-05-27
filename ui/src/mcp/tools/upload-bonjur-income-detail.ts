import { z } from 'zod';
import { readFile } from 'fs/promises';

const UploadBonjurIncomeDetailInput = z.object({
  file_path: z.string().describe('Absolute path to the Bonjur Qimai income detail CSV file'),
  store: z.string().describe('Store code (e.g. wz_wxc for 温州万象城)'),
});

export const uploadBonjurIncomeDetailTool = {
  name: 'upload_bonjur_income_detail',
  description: `Upload a Bonjur Qimai income detail CSV to bonjur_ods.income_detail.

**Parameters**:
- file_path (required): absolute path to the CSV file
- store (required): store code

**Response**: sourceFileId, fileName, totalRows, insertedRows, skipped flag`,
  inputSchema: UploadBonjurIncomeDetailInput,
  async execute(params: z.infer<typeof UploadBonjurIncomeDetailInput>) {
    const { file_path, store } = params;
    const fileBuffer = await readFile(file_path);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const form = new FormData();
    const filename = file_path.split('/').pop() || 'income_detail.csv';
    form.append('file', new Blob([fileBuffer]), filename);
    form.append('store', store);

    const res = await fetch(`${baseUrl}/api/bonjur/income/upload-qimai`, {
      method: 'POST',
      headers: { 'x-mcp-session': 'internal' },
      body: form,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`upload_bonjur_income_detail failed: ${err}`);
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
