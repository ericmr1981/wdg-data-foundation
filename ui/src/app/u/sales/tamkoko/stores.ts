// ui/src/app/u/sales/tamkoko/stores.ts
// Tamkoko 门店常量:page.tsx 与多店组件共享,避免散落硬编码

const CHART_COLORS = ['#2563eb', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

export interface StoreDef {
    code: string;
    name: string;
    color: string;
}

export const STORES: StoreDef[] = [
    { code: 'sh_sjh',    name: '上海世纪汇店',     color: CHART_COLORS[0] },
    { code: 'hz_fuyang', name: '杭州富阳店',       color: CHART_COLORS[1] },
    { code: 'wz_bjwxc',  name: '温州滨江万象城店', color: CHART_COLORS[2] },
];

export const ALL_STORE = { code: 'all', name: '全部门店' };

export const STORE_OPTIONS = [ALL_STORE, ...STORES];

export function storeName(code: string): string {
    if (code === ALL_STORE.code) return ALL_STORE.name;
    return STORES.find(s => s.code === code)?.name ?? code;
}

export function storeColor(code: string): string {
    return STORES.find(s => s.code === code)?.color ?? CHART_COLORS[3];
}
