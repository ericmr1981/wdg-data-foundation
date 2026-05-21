'use client';

export interface LineItem {
  section: string;
  label: string;
  amount: number;
  indent: number;
  is_subtotal: boolean;
  is_highlight: boolean;
}

interface StatementTableProps {
  lines: LineItem[];
}

export default function StatementTable({ lines }: StatementTableProps) {
  const formatAmount = (amount: number) => {
    const abs = Math.abs(amount);
    const formatted = abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return amount < 0 ? `(${formatted})` : formatted;
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-2/3">项目</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-1/3">金额</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {lines.map((line, idx) => (
            <tr
              key={idx}
              className={`
                ${line.is_highlight ? 'bg-blue-50 font-bold' : ''}
                ${line.is_subtotal ? 'font-semibold' : ''}
                hover:bg-gray-50 transition-colors
              `}
            >
              <td
                className={`
                  px-4 py-2.5 text-sm whitespace-nowrap
                  ${line.indent > 0 ? 'pl-8' : ''}
                  ${line.is_highlight ? 'text-blue-900' : 'text-gray-900'}
                `}
              >
                {line.label}
              </td>
              <td className={`px-4 py-2.5 text-sm whitespace-nowrap text-right ${line.amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {formatAmount(line.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
