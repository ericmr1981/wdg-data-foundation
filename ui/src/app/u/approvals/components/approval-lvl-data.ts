// Lvl1/lvl2 classification options with codes.
// Must match dim_category_lvl1/lvl2 tables in the database.

export const LVL1_OPTIONS: Array<{ code: string; name: string }> = [
  { code: 'REVENUE',       name: '营业收入' },
  { code: 'OTHER_IN',     name: '其他收入' },
  { code: 'RENT',         name: '租金物业' },
  { code: 'HR',           name: '人力' },
  { code: 'FREIGHT',      name: '运费' },
  { code: 'MGMT',         name: '管理费用' },
  { code: 'PURCHASE',     name: '材料采购' },
  { code: 'CONSTRUCT',    name: '营建费用' },
  { code: 'MARKETING',    name: '营销费用' },
  { code: 'OTHER_OUT',    name: '其他费用' },
];

// Direction constraint: income vs expense
const LVL1_DIRECTION: Record<string, 'in' | 'out'> = {
  '营业收入':  'in',
  '其他收入':  'in',
  '租金物业':  'out',
  '人力':      'out',
  '运费':      'out',
  '管理费用':  'out',
  '材料采购':  'out',
  '营建费用':  'out',
  '营销费用':  'out',
  '其他费用':  'out',
};

export function txnDirection(txn: { in_amt?: number | null; out_amt?: number | null }): 'in' | 'out' | 'any' {
  const inAmt  = Number(txn?.in_amt  ?? 0);
  const outAmt = Number(txn?.out_amt ?? 0);
  if (inAmt  > 0) return 'in';
  if (outAmt > 0) return 'out';
  return 'any';
}

export function allowedLvl1ByDirection(direction: 'in' | 'out' | 'any'): string[] {
  if (direction === 'any') return LVL1_OPTIONS.map(o => o.name);
  return LVL1_OPTIONS
    .filter(o => LVL1_DIRECTION[o.name] === direction)
    .map(o => o.name);
}

export const LVL2_OPTIONS: Record<string, Array<{ code: string; name: string }>> = {
  '营业收入':  [
    { code: 'MEITUAN',     name: '美团' },
    { code: 'ELE',         name: '饿了么' },
    { code: 'DOUYIN',      name: '抖音' },
    { code: 'JD',          name: '京东' },
    { code: 'WECHAT',      name: '微信/财付通' },
    { code: 'ALIPAY',      name: '支付宝' },
    { code: 'OTHER_CH',    name: '其他渠道' },
  ],
  '其他收入':  [
    { code: 'INVEST',      name: '注资' },
    { code: 'LOAN',        name: '借款' },
    { code: 'BANK_LOAN',   name: '贷款' },
    { code: 'INTEREST',    name: '利息' },
    { code: 'TAX_REFUND',  name: '退税' },
    { code: 'REFUND',      name: '退款' },
  ],
  '租金物业':  [
    { code: 'RENT',        name: '租金' },
    { code: 'PROPERTY',    name: '物业费' },
    { code: 'UTILITY',     name: '水电费' },
  ],
  '人力':      [
    { code: 'SALARY',      name: '工资' },
    { code: 'SOCIAL',      name: '社保' },
    { code: 'LABOR',       name: '劳务派遣' },
    { code: 'HR_SVC',      name: '人力服务' },
  ],
  '运费':      [
    { code: 'LALAFY',      name: '货拉拉' },
    { code: 'EXPRESS',     name: '快递' },
    { code: 'SAME_CITY',   name: '同城配送' },
    { code: 'OTHER_FRT',   name: '其他运费' },
  ],
  '管理费用':  [
    { code: 'SYS_FEE',     name: '系统使用费' },
    { code: 'OFFICE',      name: '办公费用' },
    { code: 'TRAVEL',      name: '差旅费' },
    { code: 'REPAIR',      name: '维修费' },
    { code: 'OTHER_MGMT',  name: '其他管理' },
    { code: 'BANK_FEE',    name: '银行手续费' },
    { code: 'PAY_GATE',    name: '支付通道费' },
  ],
  '材料采购':  [
    { code: 'RAW_MAT',     name: '原材料' },
    { code: 'AUX_MAT',     name: '辅料' },
    { code: 'PACKAGE',     name: '包装' },
    { code: 'OTHER_PUR',   name: '其他采购' },
  ],
  '营建费用':  [
    { code: 'PROJECT',     name: '工程款' },
    { code: 'CONSTRUCT_F', name: '施工费' },
    { code: 'RENOVATION',  name: '装修费' },
    { code: 'EQUIP',       name: '设备采购' },
    { code: 'OTHER_CONST', name: '其他营建' },
  ],
  '营销费用':  [
    { code: 'AD',          name: '广告费' },
    { code: 'GIFT',        name: '礼品费' },
    { code: 'PROMO',       name: '推广费' },
    { code: 'MARKETING_F', name: '营销费' },
    { code: 'OTHER_MKT',   name: '其他营销' },
  ],
  '其他费用':  [
    { code: 'TAX',         name: '税金' },
    { code: 'REPAY',       name: '还款' },
    { code: 'REFUND_OUT',  name: '退款' },
  ],
};