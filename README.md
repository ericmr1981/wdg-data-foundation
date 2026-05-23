# WDG Data Foundation

营业日报 + 银行流水 + 配送明细 → 清洗 / 分类 / 建模 → 可视化看板（UI / Metabase）

## 数据类型

| 类型 | 说明 |
|------|------|
| 营业日报 | 门店每日经营数据 |
| 银行流水 | 资金进出记录 |
| 配送明细 | 新天地等品牌门店配送订单 |

## 功能入口

- **上传入口**: `/upload` — 支持三类数据源上传，自动触发清洗导入
- **新天地看板**: `/xintiandi` — 配送数据月总览、趋势分析、品项统计
- **Metabase**: `http://112.124.18.246:8082` — 多品牌数据报表

## 技术栈

- **前端**: Next.js (UI)
- **后端**: Python (数据处理脚本)
- **数据库**: PostgreSQL
- **可视化**: Metabase

## 部署

GitHub Actions 自动部署到 VPS，push 到 `main` 分支触发。

```bash
# 本地开发
bash scripts/init_local_env.sh
bash docs/LOCAL_STARTUP.md

# VPS 部署
docker-compose -f docker-compose.dashboard.yml up -d --build ui
```

## 相关文档

- `docs/LOCAL_STARTUP.md` — 本地启动
- `docs/ACCEPTANCE_RUNBOOK.md` — 验收测试
- `docs/XINTIANDI_MODULE.md` — 新天地模块说明
