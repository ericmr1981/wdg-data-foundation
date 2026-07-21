'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface StoreOption {
  store_code: string;
  store_name: string;
}

interface Props {
  brand: 'tamkoko' | 'gelatomiiix';
  stores: StoreOption[];
  disabled?: boolean;
  disabledReason?: string;
}

export function InventoryEntryForm({ brand, stores, disabled = false, disabledReason }: Props) {
  const router = useRouter();
  const today = new Date();
  const defaultPeriod = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  const [storeCode, setStoreCode] = useState(stores[0]?.store_code ?? '');
  const [period, setPeriod] = useState(defaultPeriod);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setError(null);
    const num = Number(amount);
    if (!isFinite(num) || num < 0) {
      setError('金额必须为非负数字');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/inventory/${brand}/summary`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ store_code: storeCode, period, total_amount: num, note: note || null }),
      });
      const body = await res.json();
      if (!res.ok || !body.success) throw new Error(body.error || `HTTP ${res.status}`);
      setAmount('');
      setNote('');
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (disabled) {
    return (
      <div className="bg-gray-50 border border-dashed border-gray-300 rounded p-4 mb-6">
        <div className="text-sm text-gray-600">
          <span className="font-medium text-gray-700">月度录入已停用。</span>
          {disabledReason ? ` ${disabledReason}` : ''}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="bg-white rounded border p-4 mb-6 flex flex-wrap items-end gap-3">
      <label className="flex flex-col text-xs text-gray-600">
        门店
        <select
          value={storeCode}
          onChange={(e) => setStoreCode(e.target.value)}
          className="border rounded px-2 py-1 text-sm min-w-[8rem]"
        >
          {stores.map((s) => (
            <option key={s.store_code} value={s.store_code}>{s.store_name}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col text-xs text-gray-600">
        期间
        <input
          type="month"
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="border rounded px-2 py-1 text-sm w-36"
        />
      </label>
      <label className="flex flex-col text-xs text-gray-600">
        金额 (¥)
        <input
          type="number"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="border rounded px-2 py-1 text-sm w-32"
        />
      </label>
      <label className="flex flex-col text-xs text-gray-600 flex-1 min-w-[12rem]">
        备注
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={submitting || !storeCode}
        className="bg-blue-600 text-white text-sm px-4 py-1.5 rounded disabled:opacity-50"
      >
        {submitting ? '保存中…' : '保存'}
      </button>
      {error && <div className="text-xs text-red-600 w-full">{error}</div>}
    </form>
  );
}
