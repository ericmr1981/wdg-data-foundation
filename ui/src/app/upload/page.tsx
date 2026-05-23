'use client';

import { useState, useRef, useEffect } from 'react';
import { useBrand } from '@/lib/brand-context';

export default function UploadPage() {
  const { brand: globalBrand } = useBrand();
  const [file, setFile] = useState<File | null>(null);
  const [brand, setBrand] = useState(globalBrand);
  const [store, setStore] = useState('yf_gh');
  const [source, setSource] = useState('bank');
  const [triggerImport, setTriggerImport] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync with global brand
  useEffect(() => {
    setBrand(globalBrand);
  }, [globalBrand]);

  // Get current system time for display
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const yyyyMM = `${year}-${month}`;

  const [brands, setBrands] = useState<Array<{ code: string; name: string }>>([]);
  const [stores, setStores] = useState<Array<{ code: string; name: string }>>([]);

  useEffect(() => {
    fetch('/api/brands')
      .then(r => r.json())
      .then(d => {
        if (d?.success) {
          setBrands((d.data || []).map((x: any) => ({ code: x.brand_code, name: x.brand_name })));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!brand) return;
    fetch(`/api/stores?brand=${brand}`)
      .then(r => r.json())
      .then(d => {
        if (d?.success) {
          const nextStores = (d.data || []).map((x: any) => ({ code: x.store_code, name: x.store_name }));
          setStores(nextStores);
          if (nextStores.length && !nextStores.find((s: any) => s.code === store)) {
            setStore(nextStores[0].code);
          }
        }
      })
      .catch(() => {});
  }, [brand]);

  const sources = [
    { code: 'bank', name: '银行流水' },
    { code: 'sales', name: '营业数据' }
  ];

  // Fetch coverage for the uploaded file
  async function fetchCoverage(fileId: number) {
    try {
      const res = await fetch(`/api/coverage/by-file?brand=${brand}`);
      const data = await res.json();
      if (data.success) {
        const fileCoverage = data.data?.find((c: any) => c.source_file_id === fileId);
        if (fileCoverage) {
          setCoverage(fileCoverage);
        }
      }
    } catch (err) {
      console.error('Failed to fetch coverage:', err);
    }
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('请选择要上传的文件');
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);
    setCoverage(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('brand', brand);
      formData.append('store', store);
      formData.append('source', source);
      formData.append('triggerImport', triggerImport.toString());

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (data.success) {
        setResult(data.data);

        // If imported successfully, fetch coverage after a short delay
        if (data.data?.sourceFileId && triggerImport) {
          setTimeout(() => {
            fetchCoverage(data.data.sourceFileId);
          }, 1000);
        }
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  function getCoverageColor(rate: number) {
    if (rate >= 90) return 'text-green-600';
    if (rate >= 70) return 'text-yellow-600';
    return 'text-red-600';
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">文件上传</h1>

      <div className="bg-white shadow rounded-lg p-6">
        <form onSubmit={handleUpload} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 品牌 */}
            <div>
              <label className="block text-sm font-medium text-gray-700">品牌</label>
              <select
                value={brand}
                onChange={(e) => {
                  const nextBrand = e.target.value as string;
                  setBrand(nextBrand);
                }}
                className="mt-1 block w-full border rounded-md px-3 py-2"
              >
                {brands.map(b => (
                  <option key={b.code} value={b.code}>{b.name}</option>
                ))}
              </select>
            </div>

            {/* 门店 */}
            <div>
              <label className="block text-sm font-medium text-gray-700">门店</label>
              <select
                value={store}
                onChange={(e) => setStore(e.target.value)}
                className="mt-1 block w-full border rounded-md px-3 py-2"
              >
                {stores.map(s => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            </div>

            {/* 数据源 */}
            <div>
              <label className="block text-sm font-medium text-gray-700">数据源</label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="mt-1 block w-full border rounded-md px-3 py-2"
              >
                {sources.map(s => (
                  <option key={s.code} value={s.code}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 文件上传 */}
          <div>
            <label className="block text-sm font-medium text-gray-700">选择文件</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mt-1 block w-full border rounded-md px-3 py-2"
              required
            />
            <p className="mt-1 text-sm text-gray-500">
              支持 .xlsx, .xls, .csv 格式。文件将上传到 inputs/{brand}/{store}/{source}/{yyyyMM}/（使用系统当前时间）
            </p>
          </div>

          {/* 触发导入 */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="triggerImport"
              checked={triggerImport}
              onChange={(e) => setTriggerImport(e.target.checked)}
              className="mr-2"
            />
            <label htmlFor="triggerImport" className="text-sm text-gray-700">
              触发导入（上传后自动运行导入脚本）
            </label>
          </div>

          {/* 提交按钮 */}
          <button
            type="submit"
            disabled={uploading || !file}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? '上传中...' : '上传并保存'}
          </button>
        </form>
      </div>

      {/* 错误信息 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <div className="font-medium">上传失败</div>
          <div className="text-sm mt-1">{error}</div>
        </div>
      )}

      {/* 结果展示 */}
      {result && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="font-medium text-green-800">上传成功</div>
          <div className="text-sm mt-2 space-y-1 text-green-700">
            <div>文件路径: {result.filePath}</div>
            <div>文件名: {result.fileName}</div>
            {result.sourceFileId && (
              <div>文件ID: {result.sourceFileId}</div>
            )}
            {result.importStatus && (
              <div>导入状态: {result.importStatus}{result.rowCount != null ? `（row_count=${result.rowCount}）` : ''}</div>
            )}
            {result.errorMessage && (
              <div className="text-red-600">导入错误（DB 记录）: {result.errorMessage}</div>
            )}
            {result.importResult && (
              <div className="mt-2">
                <div className="font-medium">导入结果:</div>
                <pre className="mt-1 p-2 bg-white rounded text-xs overflow-auto max-h-64">
                  {result.importResult}
                </pre>
              </div>
            )}
            {result.importError && (
              <div className="mt-2 text-red-600">
                <div className="font-medium">导入错误:</div>
                <pre className="mt-1 p-2 bg-red-100 rounded text-xs overflow-auto max-h-64">
                  {result.importError}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 覆盖率展示 */}
      {coverage && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="font-medium text-blue-800 mb-3">文件覆盖率</div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-blue-100">
                <tr>
                  <th className="px-3 py-2 text-left">总笔数</th>
                  <th className="px-3 py-2 text-right">已分类</th>
                  <th className="px-3 py-2 text-right">覆盖率(笔数)</th>
                  <th className="px-3 py-2 text-right">总转入</th>
                  <th className="px-3 py-2 text-right">覆盖率(转入)</th>
                  <th className="px-3 py-2 text-right">总转出</th>
                  <th className="px-3 py-2 text-right">覆盖率(转出)</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                <tr>
                  <td className="px-3 py-2">{coverage.total_rows}</td>
                  <td className="px-3 py-2 text-right">{coverage.covered_rows}</td>
                  <td className={`px-3 py-2 text-right font-medium ${getCoverageColor(coverage.coverage_rate_rows)}`}>
                    {coverage.coverage_rate_rows}%
                  </td>
                  <td className="px-3 py-2 text-right">¥{coverage.total_in_amt?.toLocaleString() || 0}</td>
                  <td className={`px-3 py-2 text-right font-medium ${getCoverageColor(coverage.coverage_rate_in_amt)}`}>
                    {coverage.coverage_rate_in_amt}%
                  </td>
                  <td className="px-3 py-2 text-right">¥{coverage.total_out_amt?.toLocaleString() || 0}</td>
                  <td className={`px-3 py-2 text-right font-medium ${getCoverageColor(coverage.coverage_rate_out_amt)}`}>
                    {coverage.coverage_rate_out_amt}%
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-blue-600">
            * 覆盖率会在导入后自动计算，如需最新数据请刷新页面
          </div>
        </div>
      )}

      {/* 说明 */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="font-medium text-gray-900 mb-2">使用说明</h3>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>1. 选择品牌、门店、数据源类型</li>
          <li>2. 选择要上传的 Excel/CSV 文件</li>
          <li>3. 如果需要自动导入，可以勾选"触发导入"</li>
          <li>4. 点击"上传并保存"按钮</li>
          <li>5. 文件会上传到 inputs/ 目录，并可选择触发相应的导入脚本</li>
          <li>6. 勾选"触发导入"后，上传成功会显示该文件的覆盖率统计</li>
        </ul>
      </div>
    </div>
  );
}
