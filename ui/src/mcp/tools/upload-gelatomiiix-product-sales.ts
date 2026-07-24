import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { readFile } from 'fs/promises';

const UploadGelatomiiixProductSalesInput = z.object({
  file_path: z.string().describe('Absolute path to the gelatomiiix Qimai product sales detail CSV file'),
  store: z.string().describe('Store code (e.g. sh_xtd for 上海新天地店, sh_sc for 供应链)'),
  period: z.string().optional().describe('Period in YYYY-MM format (optional, defaults to current month)'),
});

export const uploadGelatomiiixProductSalesTool = {
  name: 'upload_gelatomiiix_product_sales',
  description: `Upload a gelatomiiix (蜜可诗) Qimai product sales detail CSV to gelatomiiix_ods.product_sales_detail.

**Parameters**:
- file_path (required): absolute path to the CSV file
- store (required): store code (e.g. sh_xtd)
- period (optional): period in YYYY-MM format, defaults to current month

**Response**: { success, sourceFileId, fileName, totalRows, insertedRows, skipped }`,
  inputSchema: UploadGelatomiiixProductSalesInput,
  async execute(params: z.infer<typeof UploadGelatomiiixProductSalesInput>) {
    const { file_path, store, period } = params;
    const fileBuffer = await readFile(file_path);
    const form = new FormData();
    const filename = file_path.split('/').pop() || 'product_sales.csv';
    form.append('file', new Blob([fileBuffer]), filename);
    form.append('store', store);
    if (period) {
      form.append('period', period);
    }

    const res = await mcpFetch(`/api/gelatomiiix/sales/upload-product`, {
      method: 'POST',
      headers: { 'x-mcp-session': 'internal' },
      body: form,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`upload_gelatomiiix_product_sales failed: ${err}`);
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
