import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

const UploadTamkokoInventoryInput = z.object({
  file_path: z.string().describe('Absolute path to the inventory .xlsx/.xls file'),
  period: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').describe('Period in YYYY-MM format'),
  store_code: z.string().optional().default('hz_fuyang')
    .describe('Store code (default hz_fuyang)'),
});

export const uploadTamkokoInventoryTool = {
  name: 'upload_tamkoko_inventory',
  description: `Upload Tamkoko inventory xlsx for a period, triggers the import pipeline (writes to DB via run_import).

**Parameters**:
- file_path (required): absolute path to .xlsx/.xls
- period (required): YYYY-MM
- store_code (optional): default hz_fuyang

**Response**: import job result (file path written, spawned importer, success/error)`,
  inputSchema: UploadTamkokoInventoryInput,
  async execute(params: z.infer<typeof UploadTamkokoInventoryInput>) {
    const { file_path, period, store_code = 'hz_fuyang' } = params;
    const { readFile } = await import('fs/promises');
    const fileBuffer = await readFile(file_path);
    const form = new FormData();
    const filename = file_path.split('/').pop() || 'inventory.xlsx';
    form.append('file', new Blob([fileBuffer]), filename);
    form.append('period', period);
    form.append('storeCode', store_code);

    const res = await mcpFetch(`/api/tamkoko/upload`, {
      method: 'POST',
      headers: { 'x-mcp-session': 'internal' },
      body: form,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`upload_tamkoko_inventory failed: ${err}`);
    }

    const json = await res.json();
    if (!json.success) {
      throw new Error(json.error || 'Unknown error');
    }
    return json.data ?? json;
  },
};
