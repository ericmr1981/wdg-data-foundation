import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { readFile } from 'fs/promises';

const UploadBonjurProductSalesInput = z.object({
  file_path: z.string().describe('Absolute path to the Bonjur Qimai product sales detail CSV file'),
  store: z.string().describe('Store code (e.g. wz_wxc for 温州万象城)'),
});

export const uploadBonjurProductSalesTool = {
  name: 'upload_bonjur_product_sales',
  description: `Upload a Bonjur Qimai product sales detail CSV to bonjur_ods.product_sales_detail.

**Parameters**:
- file_path (required): absolute path to the CSV file
- store (required): store code

**Response**: sourceFileId, fileName, totalRows, insertedRows, skipped flag`,
  inputSchema: UploadBonjurProductSalesInput,
  async execute(params: z.infer<typeof UploadBonjurProductSalesInput>) {
    const { file_path, store } = params;
    const fileBuffer = await readFile(file_path);
    const form = new FormData();
    const filename = file_path.split('/').pop() || 'product_sales.csv';
    form.append('file', new Blob([fileBuffer]), filename);
    form.append('store', store);

    const res = await mcpFetch(`/api/bonjur/sales/upload-product`, {
      method: 'POST',
      headers: { 'x-mcp-session': 'internal' },
      body: form,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`upload_bonjur_product_sales failed: ${err}`);
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
