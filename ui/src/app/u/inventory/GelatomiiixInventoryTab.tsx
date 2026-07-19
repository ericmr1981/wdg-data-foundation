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
        仅录入每店每月期末库存总额(CNY)。蜜可诗无 COGS 计算链路,COGS / 周转次 列展示 <code>-</code>;
        物料级数据(件数、周转率)见上方 DailyCheck 看板。
      </p>
      <InventoryEntryForm brand="gelatomiiix" stores={stores} />
      <InventoryMonthlyTable rows={initialRows} />
    </div>
  );
}
