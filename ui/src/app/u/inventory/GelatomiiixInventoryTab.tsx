import { InventoryEntryForm } from './InventoryEntryForm';
import { InventoryMonthlyTable } from './InventoryMonthlyTable';
import { DailyCheckBoard } from './DailyCheckBoard';
import type { InventorySummaryRow } from '@/lib/inventory-summary-types';

interface StoreOption { store_code: string; store_name: string; }

interface Props {
  stores: StoreOption[];
  initialRows: InventorySummaryRow[];
}

export function GelatomiiixInventoryTab({ stores, initialRows }: Props) {
  return (
    <div>
      <DailyCheckBoard />
      <p className="text-sm text-gray-600 mb-4">
        蜜可诗物料级库存数据由上方 DailyCheck 看板提供(月度总额录入已停用);
        历史月度盘点记录仍展示在下方表格中(COGS / 周转次 列展示 <code>-</code>)。
      </p>
      <InventoryEntryForm
        brand="gelatomiiix"
        stores={stores}
        disabled
        disabledReason="蜜可诗物料级库存数据由 DailyCheck 看板提供；月度总额录入已停用。"
      />
      <InventoryMonthlyTable rows={initialRows} />
    </div>
  );
}
