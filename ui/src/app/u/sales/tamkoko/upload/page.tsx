'use client';

import { useState } from 'react';
import Link from 'next/link';

const STORE_OPTIONS = [
    { code: 'sh_sjh', name: '上海世纪汇店' },
    { code: 'hz_fuyang', name: '杭州富阳店' },
    { code: 'wz_bjwxc', name: '温州滨江万象城店' },
];

interface UploadResult {
    sourceFileId?: number;
    fileName?: string;
    totalRows?: number | null;
    insertedRows?: number | null;
    skipped?: boolean;
    stdout?: string;
}

export default function UploadCashRegisterPage() {
    const [file, setFile] = useState<File | null>(null);
    const [store, setStore] = useState('sh_sjh');
    const [period, setPeriod] = useState('');
    const [replace, setReplace] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<UploadResult | null>(null);

    const submit = async () => {
        if (!file) { setError('请选择文件'); return; }
        setUploading(true); setError(null); setResult(null);
        try {
            const fd = new FormData();
            fd.append('file', file);
            fd.append('store', store);
            if (period) fd.append('period', period);
            if (replace) fd.append('replace', 'true');
            const res = await fetch('/api/tamkoko/sales/upload-cash-register', {
                method: 'POST',
                body: fd,
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'upload failed');
            setResult(json.data ?? {});
        } catch (e) {
            setError(e instanceof Error ? e.message : 'upload failed');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="p-6 max-w-3xl mx-auto space-y-4">
            <div className="flex items-center gap-2 text-sm">
                <Link href="/u/sales/tamkoko" className="text-blue-600 hover:underline">← 返回报表</Link>
            </div>
            <h1 className="text-2xl font-bold">上传收银明细</h1>
            <p className="text-sm text-gray-500">企迈"收银明细表"CSV(UTF-8 BOM,11 列:门店名称/日期/订单号/营业额/营业收入/优惠总额/订单来源/订单类型/餐段/营业净收/销量)。同 SHA256 已导入则跳过。</p>

            <div className="bg-white border rounded-lg p-4 space-y-4">
                <div>
                    <label className="text-sm text-gray-500">CSV 文件</label>
                    <div className="mt-1 border-2 border-dashed rounded p-4 text-center cursor-pointer hover:bg-gray-50 relative">
                        <input type="file" accept=".csv" onChange={e => setFile(e.target.files?.[0] ?? null)} className="absolute inset-0 opacity-0 cursor-pointer" />
                        {file ? <div className="text-sm">{file.name} ({Math.round(file.size / 1024)} KB)</div> : <div className="text-sm text-gray-400">点击选择 .csv 文件</div>}
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-sm text-gray-500">门店</label>
                        <select className="mt-1 w-full border rounded px-2 py-1 text-sm" value={store} onChange={e => setStore(e.target.value)}>
                            {STORE_OPTIONS.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="text-sm text-gray-500">月份(可选,默认当前)</label>
                        <input type="month" className="mt-1 w-full border rounded px-2 py-1 text-sm" value={period} onChange={e => setPeriod(e.target.value)} />
                    </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={replace} onChange={e => setReplace(e.target.checked)} />
                    覆盖同月份旧数据(慎用,会清旧 source_file 后重写)
                </label>
                <button onClick={submit} disabled={uploading || !file} className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed">
                    {uploading ? '上传中...' : '上传并导入'}
                </button>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
                    ❌ {error}
                </div>
            )}
            {result && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded text-sm space-y-1">
                    ✅ 上传成功{result.skipped ? '(已导入过,跳过)' : ''}
                    <div className="text-xs text-gray-600 mt-1">
                        文件: {result.fileName} · sourceFileId: {result.sourceFileId} · 行数: {result.insertedRows ?? result.totalRows}
                    </div>
                    {result.stdout && (
                        <pre className="mt-2 p-2 bg-white border rounded text-xs whitespace-pre-wrap max-h-40 overflow-auto">{result.stdout}</pre>
                    )}
                </div>
            )}
        </div>
    );
}
