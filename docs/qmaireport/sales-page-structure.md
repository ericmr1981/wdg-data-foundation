# 销售分析页 — 页面结构

路由：`/u/sales`, `/u/sales/details`  
文件：[ui/src/app/u/sales/page.tsx](ui/src/app/u/sales/page.tsx), [details/page.tsx](ui/src/app/u/sales/details/page.tsx)

---

## 1. `/u/sales` 销售概览

```
SalesReportPage ('use client')
├── 控制栏 (门店, 月份, 支付方式, 纯模式开关)
├── 4个Tab视图
│   ├── Tab 门店概览
│   │   ├── KPI卡片 (本日/本月销售额等)
│   │   ├── 每日销售额折线图 (LineChart)
│   │   └── 支付渠道占比饼图 (PieChart)
│   ├── Tab 商品分析
│   │   ├── Top10 销售额柱状图 (BarChart)
│   │   └── Top10 销售量柱状图 (BarChart)
│   ├── Tab 支付渠道
│   │   └── 支付渠道明细表格
│   └── Tab 月度趋势
│       └── 12月销售额趋势折线图 (LineChart)
└── 加载/错误/空状态
```

## 2. `/u/sales/details` 销售明细

```
SalesDetailsPage ('use client')
├── 控制栏 (门店, 月份, 纯模式开关)
├── 2个Tab视图
│   ├── Tab 收银明细 → 分页表格 (每页50行)
│   └── Tab 商品销售明细 → 分页表格
└── 底部分页栏
```
