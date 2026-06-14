import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';
import { readFile } from 'fs/promises';
import { assertApiSuccess } from '@/lib/api-error';

const UploadBonjurSalesInput = z.object({
  file_path: z.string().describe('Absolute path to the Bonjur self-service sales CSV file'),
  store: z.string().describe('Store code (e.g. wz_oh_wxc for 温州瓯海万象城店)'),
});

export const uploadBonjurSalesSelfServiceTool = {
  name: 'upload_bonjur_sales_self_service',
  description: `Upload a Bonjur self-service daily sales CSV to bonjur_ods.sales_daily_self_service.

**Parameters**:
- file_path (required): absolute path to the CSV
- store (required): store code

**Response**: sourceFileId, fileName, totalRows, insertedRows, skipped flag`,
  inputSchema: UploadBonjurSalesInput,
  async execute(params: z.infer<typeof UploadBonjurSalesInput>) {
    const { file_path, store } = params;
    const fileBuffer = await readFile(file_path);
    const form = new FormData();
    const filename = file_path.split('/').pop() || 'sales.csv';
    form.append('file', new Blob([fileBuffer]), filename);
    form.append('store', store);

    const res = await mcpFetch(`/api/bonjur/sales/upload-self-service`, {
      method: 'POST',
      headers: { 'x-mcp-session': 'internal' },
      body: form,
    });

    const json = await assertApiSuccess(res, 'upload_bonjur_sales_self_service');
    const data = ((json as Record<string, unknown>).data as Record<string, unknown>) ?? json;
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
