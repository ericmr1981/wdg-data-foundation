'use client';

import { useEffect, useState } from 'react';
import { useBrand } from '@/lib/brand-context';
import type { PipelineRun, CoverageByFile, UnclassifiedByFile } from '@/lib/types';

export default function PipelinePage() {
  const { brand } = useBrand();
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [coverageByFile, setCoverageByFile] = useState<CoverageByFile[]>([]);
  const [expandedFile, setExpandedFile] = useState<number | null>(null);
  const [unclassifiedByFile, setUnclassifiedByFile] = useState<Record<number, UnclassifiedByFile[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [pipelineRes, coverageRes] = await Promise.all([
          fetch('/api/pipeline'),
          fetch(`/api/coverage/by-file?brand=${brand}`)
        ]);

        if (!pipelineRes.ok || !coverageRes.ok) {
          throw new Error('Failed to fetch data');
        }

        const pipelineData = await pipelineRes.json();
        const coverageData = await coverageRes.json();

        setRuns(pipelineData.data || []);
        setCoverageByFile(coverageData.data || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [brand]);

  async function toggleFileCoverage(fileId: number) {
    if (expandedFile === fileId) {
      setExpandedFile(null);
      return;
    }

    setExpandedFile(fileId);

    // 如果还没有加载该文件的未分类数据，则加载
    if (!unclassifiedByFile[fileId]) {
      try {
        const res = await fetch(`/api/coverage/unclassified-by-file?brand=${brand}&file_id=${fileId}`);
        const data = await res.json();
        if (data.success) {
          setUnclassifiedByFile(prev => ({ ...prev, [fileId]: data.data || [] }));
        }
      } catch (err) {
        console.error('Failed to load unclassified data:', err);
      }
    }
  }

  function getCoverageColor(rate: number) {
    if (rate >= 90) return 'text-green-600';
    if (rate >= 70) return 'text-yellow-600';
    return 'text-red-600';
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        错误: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Pipeline 监控</h1>

      {/* 按文件维度覆盖率面板 T8.5 */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">覆盖率统计 (按上传文件)</h2>
        {coverageByFile.length === 0 ? (
          <p className="text-gray-500">暂无数据</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">文件名</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">门店</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">月份</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">总笔数</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">已分类</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">覆盖率</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">详情</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {coverageByFile.map((c) => (
                  <>
                    <tr key={c.source_file_id}>
                      <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">{c.file_name}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">{c.store_code}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500">{c.file_month}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 text-right">{c.total_rows}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-500 text-right">{c.covered_rows}</td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm text-right">
                        <span className={getCoverageColor(c.coverage_rate_rows)}>
                          {c.coverage_rate_rows}%
                        </span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-sm">
                        <button
                          onClick={() => toggleFileCoverage(c.source_file_id)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          {expandedFile === c.source_file_id ? '收起' : '查看未分类'}
                        </button>
                      </td>
                    </tr>
                    {expandedFile === c.source_file_id && unclassifiedByFile[c.source_file_id] && (
                      <tr>
                        <td colSpan={7} className="px-4 py-3 bg-gray-50">
                          <div className="text-sm font-medium text-gray-700 mb-2">未分类 Top 20:</div>
                          {unclassifiedByFile[c.source_file_id].length === 0 ? (
                            <p className="text-sm text-gray-500">暂无未分类数据</p>
                          ) : (
                            <div className="overflow-x-auto max-h-64">
                              <table className="min-w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-gray-100">
                                  <tr>
                                    <th className="px-2 py-1 text-left">对方单位</th>
                                    <th className="px-2 py-1 text-left">摘要</th>
                                    <th className="px-2 py-1 text-right">笔数</th>
                                    <th className="px-2 py-1 text-right">总金额</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-white divide-y divide-gray-200">
                                  {unclassifiedByFile[c.source_file_id].map((u, idx) => (
                                    <tr key={idx} className="hover:bg-gray-50">
                                      <td className="px-2 py-1 whitespace-nowrap">{u.counterparty_name || '-'}</td>
                                      <td className="px-2 py-1 whitespace-nowrap">{u.summary || '-'}</td>
                                      <td className="px-2 py-1 text-right">{u.txn_rows}</td>
                                      <td className="px-2 py-1 text-right">¥{u.total_amt.toLocaleString()}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pipeline 运行记录 */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Pipeline 运行记录 (最近20条)</h2>
        {runs.length === 0 ? (
          <p className="text-gray-500">暂无运行记录</p>
        ) : (
          <div className="space-y-4">
            {runs.map((run) => {
              // 解析 note 中的 rerun 信息
              let noteData: { run_type?: string; source_file_ids?: number[]; file_names?: string[] } | null = null;
              try {
                if (run.note) {
                  noteData = JSON.parse(run.note);
                }
              } catch (e) { /* ignore */ }
              const isRerun = noteData?.run_type === 'rerun_match';

              return (
                <div key={run.run_id} className={`border rounded-lg p-4 ${isRerun ? 'border-orange-300 bg-orange-50' : ''}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-3">
                      {isRerun && (
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-800">
                          RERUN
                        </span>
                      )}
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        run.status === 'success' ? 'bg-green-100 text-green-800' :
                        run.status === 'failed' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {run.status}
                      </span>
                      <span className="font-medium text-gray-900">{run.brand_code}</span>
                      {run.store_code && <span className="text-gray-500">/ {run.store_code}</span>}
                      {run.month && <span className="text-gray-500">/ {run.month}</span>}
                    </div>
                    <div className="text-sm text-gray-500">
                      {new Date(run.started_at).toLocaleString('zh-CN')}
                      {run.finished_at && ` → ${new Date(run.finished_at).toLocaleString('zh-CN')}`}
                    </div>
                  </div>

                  {/* RERUN 详情 */}
                  {isRerun && noteData && (
                    <div className="mt-2 pl-4 border-l-2 border-orange-200 text-sm">
                      <div className="text-gray-600">
                        重新执行分类匹配：
                        {noteData.source_file_ids?.map((id, idx) => (
                          <span key={id} className="ml-2">
                            <span className="text-orange-700">{id}</span>
                            {noteData.file_names?.[idx] && <span className="text-gray-500">({noteData.file_names[idx]})</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 步骤详情 */}
                  {run.steps && run.steps.length > 0 && (
                    <div className="mt-3 pl-4 border-l-2 border-gray-200 space-y-2">
                      {run.steps.map((step: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between text-sm">
                          <div className="flex items-center space-x-2">
                            <span className={`w-2 h-2 rounded-full ${
                              step.status === 'success' ? 'bg-green-500' :
                              step.status === 'failed' ? 'bg-red-500' :
                              step.status === 'running' ? 'bg-yellow-500' :
                              'bg-gray-300'
                            }`}></span>
                            <span className="text-gray-700">{step.step_name}</span>
                          </div>
                          <div className="flex items-center space-x-4 text-gray-500">
                            {step.rows_out !== null && <span>{step.rows_out} rows</span>}
                            {step.duration_sec !== null && <span>{step.duration_sec}s</span>}
                            {step.error_message && <span className="text-red-500">{step.error_message}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
