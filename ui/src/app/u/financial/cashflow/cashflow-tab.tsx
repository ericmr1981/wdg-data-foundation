import StatementTable, { LineItem } from '../StatementTable';

interface CashflowStatementProps {
  lines: LineItem[];
}

export default function CashflowStatement({ lines }: CashflowStatementProps) {
  if (!lines.length) return <div className="flex justify-center py-12 text-gray-400">暂无数据</div>;
  return <StatementTable lines={lines} />;
}
