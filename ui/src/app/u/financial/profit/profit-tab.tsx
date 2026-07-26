import StatementTable, { LineItem } from '../StatementTable';

interface ProfitStatementProps {
  lines: LineItem[];
}

export default function ProfitStatement({ lines }: ProfitStatementProps) {
  if (!lines.length) return <div className="flex justify-center py-12 text-gray-400">暂无数据</div>;
  return <StatementTable lines={lines} />;
}
