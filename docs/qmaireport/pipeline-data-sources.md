# 数据上传 & 管道监控页 — 数据来源清单

---

## API 调用

| 页面 | API | 数据源表 | 合规 |
|---|---|---|---|
| upload | `POST /api/upload` | raw.* (源文件 → import) | N/A (写入操作) |
| upload | `GET /api/coverage/by-file` | v_bank_txn_classified (视图) | ✅ 使用分类视图 |
| upload | `GET /api/brands` | ops.brands | N/A |
| upload | `GET /api/stores` | ops.stores | N/A |
| pipeline | `GET /api/pipeline/kpi` | **bank_txn_classified_snapshot** | ✅ 已修复 (见下) |
| pipeline | `GET /api/pipeline` | ops.pipeline_step | N/A |
| pipeline | `GET /api/coverage/by-file` | v_bank_txn_classified | ✅ 使用分类视图 |
| pipeline | `GET /api/coverage/unclassified-by-file` | v_bank_txn_classified | ✅ 使用分类视图 |

## pipeline/kpi 修复说明

**原问题 (2026-06-03 前):** 直接 `SELECT sum(in_amt + out_amt) FROM ods.bank_txn` 读总额，未分类KPI硬编码为0。

**修复后:** 改为 `JOIN bank_txn_classified_snapshot` (BASE TABLE)，按 classified_source 分组统计：
- classified_count / classified_amt: `classified_source IN ('rule', 'override')`
- unclassified_count / unclassified_amt: `classified_source = 'unclassified'`
- 同时返回 Top 20 未分类关键词

BASE TABLE 不会触发全量分类计算，性能与原方案一致（秒级）。
