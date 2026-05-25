import { z } from 'zod';

const UploadBankTxnInput = z.object({
  brand:     z.string().describe('Brand code: yufeng | gelatomiiix | bonjur'),
  store:     z.string().describe('Store code'),
  file_path: z.string().describe('Absolute path to the bank statement file (xlsx)'),
});

export const uploadBankTxnTool = {
  name: 'upload_bank_txn_file',
  description: 'Upload a bank statement Excel file, trigger import pipeline, and return file_id + row count. Call this when the user wants to upload bank transactions.',
  inputSchema: UploadBankTxnInput,
  async execute({ brand, store, file_path }: z.infer<typeof UploadBankTxnInput>) {
    const { readFile } = await import('fs/promises');
    const { createHash } = await import('crypto');
    const fileBuffer = await readFile(file_path);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:4100';
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
    return await res.json();
  },
};