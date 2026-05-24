'use client';

import { useState } from 'react';

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
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const formatAmount = (amount: number) => {
    const abs = Math.abs(amount);
    const formatted = abs.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return amount < 0 ? `(${formatted})` : formatted;
  };

  const toggleSection = (idx: number) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Group lines: section headers followed by their detail lines
  const groups: { headerIdx: number; header: LineItem; detailIndices: number[] }[] = [];
  let currentHeader: number | null = null;
  let currentDetailIndices: number[] = [];

  lines.forEach((line, idx) => {
    const isSectionHeader = line.indent === 0 && !line.is_highlight && !line.is_subtotal;
    if (isSectionHeader) {
      if (currentHeader !== null) {
        groups.push({ headerIdx: currentHeader, header: lines[currentHeader], detailIndices: currentDetailIndices });
      }
      currentHeader = idx;
      currentDetailIndices = [];
    } else if (line.indent > 0 && currentHeader !== null) {
      currentDetailIndices.push(idx);
    }
  });
  // Push last group
  if (currentHeader !== null) {
    groups.push({ headerIdx: currentHeader, header: lines[currentHeader], detailIndices: currentDetailIndices });
  }

  const collapsedDetails = new Set<number>();
  for (const g of groups) {
    if (collapsed.has(g.headerIdx)) {
      for (const di of g.detailIndices) collapsedDetails.add(di);
    }
  }

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
          {lines.map((line, idx) => {
            const isSectionHeader = line.indent === 0 && !line.is_highlight && !line.is_subtotal;
            const isCollapsed = collapsedDetails.has(idx);
            const expandIcon = isSectionHeader ? (collapsed.has(idx) ? '▶' : '▼') : '';

            return (
              <tr
                key={idx}
                className={`
                  ${line.is_highlight ? 'bg-blue-50 font-bold' : ''}
                  ${line.is_subtotal ? 'font-semibold' : ''}
                  ${isCollapsed ? 'hidden' : ''}
                  ${isSectionHeader ? 'cursor-pointer select-none' : ''}
                  hover:bg-gray-50 transition-colors
                `}
                onClick={() => isSectionHeader && toggleSection(idx)}
              >
                <td
                  className={`
                    px-4 py-2.5 text-sm whitespace-nowrap
                    ${line.indent > 0 ? 'pl-8' : ''}
                    ${line.is_highlight ? 'text-blue-900' : 'text-gray-900'}
                  `}
                >
                  {expandIcon && <span className="mr-1.5 text-xs text-gray-400 inline-block w-3">{expandIcon}</span>}
                  {expandIcon ? <span className="ml-0.5">{line.label}</span> : line.label}
                </td>
                <td className={`px-4 py-2.5 text-sm whitespace-nowrap text-right ${line.amount < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                  {formatAmount(line.amount)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
