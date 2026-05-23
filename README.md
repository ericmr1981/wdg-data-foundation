# WDG Data Foundation

Code repo for WDG（营业日报 + 银行流水 + 配送明细 → 清洗/分类/建模 → UI/Metabase）。

## 当前新增能力

- `/upload` 已支持第三类数据源：`配送明细`
- 配送明细上传后可走 `import_xintiandi_delivery.py` 导入链路
- 新天地门店可查看专用看板：`/xintiandi`
- Metabase 已可生成新天地配送看板

### 配送明细预期字段

- 配送单号
- 门店编码
- 门店名称
- 创建时间
- 品项名称
- 品项编码
- 品项分类
- 订货数量
- 审核数量
- 发货数量
- 送达数量
- 订货金额

## Local dev

```bash
cd /Users/ericmr/Documents/GitHub/wdg-data-foundation
```

- Local startup: `docs/LOCAL_STARTUP.md`
- End-to-end acceptance: `docs/ACCEPTANCE_RUNBOOK.md`
- One-click init: `scripts/init_local_env.sh`
- 新天地模块说明：`docs/XINTIANDI_MODULE.md`

## Upload / 验收补充

- 入口：`/upload`
- 数据源类型：`银行流水` / `营业数据` / `配送明细`
- 选择 `配送明细` 并勾选“触发导入”后，会自动进入配送导入脚本
- 导入成功后：
  - `/upload` 页面会显示导入摘要
  - `/xintiandi` 可查看月总览、趋势、品项分析

## Project records

Project governance / task board / acceptance evidence are maintained in Obsidian (not tracked in this repo).
