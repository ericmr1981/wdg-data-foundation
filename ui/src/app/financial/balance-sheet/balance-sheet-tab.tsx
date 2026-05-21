'use client';

import { useEffect, useState } from 'react';
import StatementTable, { LineItem } from '../StatementTable';

interface BalanceSheetProps {
  brand: string;
  period: string;
  span: string;
  store: string;
}

export default function BalanceSheet({ brand, period, span, store }: BalanceSheetProps) {
  const [lines, setLines] = useState<LineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(
          `/api/financial/balance-sheet?brand=${brand}&period=${period}&span=${span}&store=${store}`
        );
        const json = await res.json();
        if (json.success) {
          setLines(json.data?.lines || []);
        } else {
          setError(json.error);
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [brand, period, span, store]);

  if (loading) return <div className="flex justify-center py-12 text-gray-500">加载中...</div>;
  if (error) return <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">错误: {error}</div>;
  if (!lines.length) return <div className="flex justify-center py-12 text-gray-400">暂无数据</div>;

  return <StatementTable lines={lines} />;
}
