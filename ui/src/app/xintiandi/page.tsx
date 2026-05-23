'use client';

import { useEffect, useState } from 'react';
import { useBrand } from '@/lib/brand-context';

type BatchRow = {
  batch_id: string;
  file_name: string;
  total_rows: number;
  success_rows: number;
  error_rows: number;
  status: string;
  created_at: string;
  finished_at?: string;
};

type DashboardData = {
  月份?: string;
  门店?: string;
  订货数量?: number;
  审核数量?: number;
  发货数量?: number;
  送达数量?: number;
  订货金额?: number;
  配送单数?: number;
  品项分类?: string;
  "送达率%"?: number;
  品项数?: number;
};

// ── Upload component ──────────────────────────────────────────────────────────
function UploadSection() {
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('triggerImport', 'true');

    try {
      const res = await fetch('/api/xintiandi/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      
      if (data.success) {
        setResult(data.data);
      } else {
        setError(data.error || 'Upload failed');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-4">上传配送明细</h2>
      
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileChange}
          className="hidden"
          id="xintiandi-file-upload"
        />
        <label htmlFor="xintiandi-file-upload" className="cursor-pointer">
          {uploading ? (
            <span className="text-blue-600">上传中...</span>
          ) : (
            <span className="text-gray-600">
              拖拽 Excel 文件到这里，或 <span className="text-blue-600 underline">点击选择</span>
            </span>
          )}
        </label>
        <p className="text-xs text-gray-400 mt-2">支持 .xlsx, .xls, .csv</p>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded">
          <p className="text-green-700 text-sm font-medium">导入成功</p>
          <p className="text-gray-600 text-xs mt-1">文件: {result.fileName}</p>
          {result.importResult && (
            <pre className="text-xs text-gray-600 mt-2 whitespace-pre-wrap">
              {result.importResult.slice(0, 500)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Dashboard section ──────────────────────────────────────────────────────────
function DashboardSection() {
  const [overview, setOverview] = useState<DashboardData[]>([]);
  const [trend, setTrend] = useState<DashboardData[]>([]);
  const [items, setItems] = useState<DashboardData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [ovRes, trRes, itRes] = await Promise.all([
          fetch('/api/xintiandi/dashboard?type=overview'),
          fetch('/api/xintiandi/dashboard?type=trend'),
          fetch('/api/xintiandi/dashboard?type=items'),
        ]);
        
        const ovData = await ovRes.json();
        const trData = await trRes.json();
        const itData = await itRes.json();

        if (ovData.success) setOverview(ovData.data);
        if (trData.success) setTrend(trData.data);
        if (itData.success) setItems(itData.data);
      } catch (e) {
        console.error('Failed to fetch dashboard data', e);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) return <div className="text-gray-500">加载中...</div>;

  return (
    <div className="space-y-6">
      {/* 月总览 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">月总览</h2>
        {overview.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3">月份</th>
                  <th className="text-right py-2 px-3">订货数量</th>
                  <th className="text-right py-2 px-3">审核数量</th>
                  <th className="text-right py-2 px-3">发货数量</th>
                  <th className="text-right py-2 px-3">送达数量</th>
                  <th className="text-right py-2 px-3">订货金额</th>
                  <th className="text-right py-2 px-3">配送单数</th>
                </tr>
              </thead>
              <tbody>
                {overview.map((row, i) => (
                  <tr key={i} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-3">{row.月份}</td>
                    <td className="text-right py-2 px-3">{row.订货数量?.toLocaleString()}</td>
                    <td className="text-right py-2 px-3">{row.审核数量?.toLocaleString()}</td>
                    <td className="text-right py-2 px-3">{row.发货数量?.toLocaleString()}</td>
                    <td className="text-right py-2 px-3">{row.送达数量?.toLocaleString()}</td>
                    <td className="text-right py-2 px-3">¥{row.订货金额?.toLocaleString()}</td>
                    <td className="text-right py-2 px-3">{row.配送单数}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">暂无数据</p>
        )}
      </div>

      {/* 趋势数据 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">月度趋势</h2>
        {trend.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3">月份</th>
                  <th className="text-right py-2 px-3">订货数量</th>
                  <th className="text-right py-2 px-3">送达数量</th>
                  <th className="text-right py-2 px-3">订货金额</th>
                </tr>
              </thead>
              <tbody>
                {trend.map((row, i) => (
                  <tr key={i} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-3">{row.月份}</td>
                    <td className="text-right py-2 px-3">{row.订货数量?.toLocaleString()}</td>
                    <td className="text-right py-2 px-3">{row.送达数量?.toLocaleString()}</td>
                    <td className="text-right py-2 px-3">¥{row.订货金额?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">暂无数据</p>
        )}
      </div>

      {/* 品项分析 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">品项分析</h2>
        {items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 px-3">品项分类</th>
                  <th className="text-right py-2 px-3">订货数量</th>
                  <th className="text-right py-2 px-3">送达数量</th>
                  <th className="text-right py-2 px-3">订货金额</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row, i) => (
                  <tr key={i} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-3">{row.品项分类}</td>
                    <td className="text-right py-2 px-3">{row.订货数量?.toLocaleString()}</td>
                    <td className="text-right py-2 px-3">{row.送达数量?.toLocaleString()}</td>
                    <td className="text-right py-2 px-3">¥{row.订货金额?.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-500 text-sm">暂无数据</p>
        )}
      </div>
    </div>
  );
}

// ── Batch history ─────────────────────────────────────────────────────────────
function BatchHistory() {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBatches = async () => {
      try {
        const res = await fetch('/api/xintiandi/batch');
        const data = await res.json();
        if (data.success) setBatches(data.data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    fetchBatches();
  }, []);

  if (loading) return <div className="text-gray-500">加载中...</div>;

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold mb-4">导入历史</h2>
      {batches.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2 px-3">文件名</th>
                <th className="text-right py-2 px-3">总行数</th>
                <th className="text-right py-2 px-3">成功</th>
                <th className="text-right py-2 px-3">错误</th>
                <th className="text-center py-2 px-3">状态</th>
                <th className="text-left py-2 px-3">时间</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.batch_id} className="border-b hover:bg-gray-50">
                  <td className="py-2 px-3">{batch.file_name}</td>
                  <td className="text-right py-2 px-3">{batch.total_rows}</td>
                  <td className="text-right py-2 px-3 text-green-600">{batch.success_rows}</td>
                  <td className="text-right py-2 px-3 text-red-600">{batch.error_rows}</td>
                  <td className="text-center py-2 px-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      batch.status === 'completed' ? 'bg-green-100 text-green-700' :
                      batch.status === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {batch.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-500">
                    {new Date(batch.created_at).toLocaleString('zh-CN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-gray-500 text-sm">暂无导入记录</p>
      )}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function XintiandiPage() {
  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">新天地｜配送看板</h1>
          <p className="text-gray-600 text-sm mt-1">
            上海黄浦新天地时尚二期Nano店 · 配送/库存数据管理
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <DashboardSection />
          </div>
          <div className="space-y-6">
            <UploadSection />
            <BatchHistory />
          </div>
        </div>
      </div>
    </div>
  );
}
