import StatementTable, { LineItem } from '../StatementTable';

interface BalanceSheetProps {
  lines: LineItem[];
}

export default function BalanceSheet({ lines }: BalanceSheetProps) {
  if (!lines.length) return <div className="flex justify-center py-12 text-gray-400">暂无数据</div>;
  return <StatementTable lines={lines} />;
}
