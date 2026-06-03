# 数据上传 & 管道监控页 — 页面结构

---

## `/upload` 数据上传

文件：[ui/src/app/upload/page.tsx](ui/src/app/upload/page.tsx)

```
UploadPage ('use client')
├── 品牌选择
├── 门店选择 (依赖品牌)
├── 数据源选择
├── 文件选择器 (file input)
├── "触发导入" 复选框 (trigger import after upload)
├── 提交按钮
├── 错误提示
└── 上传结果
    ├── 文件路径
    ├── 导入输出
    └── 覆盖率统计表
```

## `/pipeline` 管道监控

文件：[ui/src/app/pipeline/page.tsx](ui/src/app/pipeline/page.tsx)

```
PipelinePage ('use client')
├── 软阀门KPI区块
│   ├── 未分类条数
│   ├── 未分类金额
│   ├── Top 未分类关键词
│   └── Top 未分类对方
├── 文件级覆盖率表格
│   └── 可展开行: 查看未分类详情
└── 管道运行记录 (最近20条)
    ├── 状态指示器
    ├── 重新匹配按钮
    └── 分步骤进度列表
```
