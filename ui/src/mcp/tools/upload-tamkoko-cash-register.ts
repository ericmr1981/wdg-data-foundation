import { readFile } from 'fs/promises';
import { z } from 'zod';
import { mcpFetch } from '@/lib/mcp-fetch';

export const uploadTamkokoCashRegisterTool = {
    name: 'upload_tamkoko_cash_register',
    description: [
        '上传企迈收银明细 CSV 到 tamkoko 品牌,触发 import_tamkoko_cash_register.py 导入到 ODS',
        'store_code 必须是 ops.stores 中 brand_code=tamkoko 的合法 enabled store (如 sh_sjh)',
        'period 可选,默认从文件名推断',
        'replace=true 时按 store+月份删除旧 source_file 后再写(清旧 KPI 偏差)',
        'SHA256 已 success 时返回 skipped:true 不重导',
    ].join('\n'),
    inputSchema: z.object({
        file_path: z.string().describe('本地 CSV 文件绝对路径'),
        store_code: z.string().describe('ops.stores 中 tamkoko 品牌的 store_code (如 sh_sjh)'),
        period: z.string().regex(/^\d{4}-\d{2}$/, 'YYYY-MM').optional().describe('导入月份,默认从文件名推断'),
        replace: z.boolean().optional().default(false).describe('true 时按月份清旧 source_file 后重写'),
    }),
    async execute(params: { file_path: string; store_code: string; period?: string; replace?: boolean }) {
        const { file_path, store_code, period, replace = false } = params;
        const fileBuffer = await readFile(file_path);
        const filename = file_path.split('/').pop() ?? 'upload.csv';
        const form = new FormData();
        form.append('file', new Blob([fileBuffer]), filename);
        form.append('store', store_code);
        if (period) form.append('period', period);
        if (replace) form.append('replace', 'true');

        const res = await mcpFetch('/api/tamkoko/sales/upload-cash-register', {
            method: 'POST',
            headers: { 'x-mcp-session': 'internal' },
            body: form,
        });
        if (!res.ok) throw new Error(`upload_tamkoko_cash_register failed: ${await res.text()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error || 'Unknown error');
        return json.data ?? json;
    },
};
