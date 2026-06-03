'use client';

interface Store {
  code: string;
  name: string;
}

interface Props {
  brand: string;
  brandOptions: { code: string; name: string }[];
  onBrandChange: (b: string) => void;

  stores: Store[];
  store: string;
  onStoreChange: (s: string) => void;

  month: string;
  onMonthChange: (m: string) => void;
}

function defaultMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function lastNMonths(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    const y = d.getFullYear();
    const m = d.getMonth() + 1 - i;
    const yy = m <= 0 ? y - 1 : y;
    const mm = m <= 0 ? 12 + m : m;
    out.push(`${yy}-${String(mm).padStart(2, '0')}`);
  }
  return out.reverse();
}

export function StoreFilter({
  brand, brandOptions, onBrandChange,
  stores, store, onStoreChange,
  month, onMonthChange,
}: Props) {
  const months = lastNMonths(24);

  return (
    <div className="flex flex-wrap gap-4 items-end bg-white p-4 rounded border mb-4">
      <div>
        <label className="block text-xs text-gray-500 mb-1">品牌</label>
        <select
          value={brand}
          onChange={e => onBrandChange(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2 text-sm bg-white min-w-[120px]"
        >
          {brandOptions.map(b => (
            <option key={b.code} value={b.code}>{b.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">门店</label>
        <select
          value={store}
          onChange={e => onStoreChange(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2 text-sm bg-white min-w-[180px]"
        >
          {stores.length === 0 && <option value="">(暂无门店)</option>}
          {stores.map(s => (
            <option key={s.code} value={s.code}>{s.name}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">月份</label>
        <select
          value={month}
          onChange={e => onMonthChange(e.target.value)}
          className="border border-gray-300 rounded px-3 py-2 text-sm bg-white min-w-[120px]"
        >
          {months.map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export { defaultMonth };
