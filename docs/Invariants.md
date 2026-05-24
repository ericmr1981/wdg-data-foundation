# Invariants (Local-dev)

> 本仓库只维护本地开发。

<<<<<<< HEAD
- 不在仓库中明文提交任何真实密钥（API key / DB password / cookie / token）。
- 变更必须可回滚：优先追加式 SQL（CREATE OR REPLACE / IF NOT EXISTS），避免破坏性 DROP。
- 任何会影响 schema/ETL 行为的变更：必须跑 `bash scripts/run_change_guard.sh`。
- 文档若提到部署/迁移（VPS）：统一归档，不在本仓库维护（见 `docs/VPS_ARCHIVE.md`）。
=======
## 数据与分类约束
- 一期只围绕两类输入：营业日报、银行流水。
- 品牌隔离策略固定为：同库按品牌拆 schema；Bonjur 与 Yufeng 不交叉写入/汇总。
- 收入口径保持双轨：业务口径与银行口径并存，不能混成一个数字。
- 费用口径以银行流水 `out_amt` 为准。
- 未分类允许进入 DM（软阀门），但必须持续可见并可追踪覆盖率。
- **Yufeng 未分类（unclassified）不再是字典表分类**：当 `classified_source='unclassified'` 时，`lvl1_code/lvl2_code` 允许为 `NULL`；不得在规则/override 中使用已删除的 `UNCLASSIFIED/OTHER_OUT`。
- 人工处理与规则沉淀必须可审计；规则类改动要能追溯到对应文件、接口或 SQL。

## 交付与验证约束
- 宣称“完成”前，至少要有一条可复现验证路径（命令、页面、SQL 或文档证据）。
- 直接编辑项目文档/脚本/SQL 后，优先运行 `bash scripts/run_change_guard.sh`。
- 若 guard 报风险，要么修复，要么在 `ProjectTasks.md` 明确记下风险接受范围与后续动作。
- 环境一致性：所有关键能力应能在本地一键复现（初始化、导入、UI、Metabase seed、关键 SQL 验证）。

## 指标口径硬约束（Finance）
- **总收入/总支出/利润等 headline 总指标**：必须直接从原始表 `yufeng_ods.bank_txn` 的 `in_amt/out_amt` 聚合得到；分类视图只用于切片/分组（避免 NULL 分类/字典改名导致总数错误）。

## 安全与密钥
- 不在仓库/聊天中明文放置密钥（API key / DB password / token / cookie 等）。

## 文档约束
- 新文件优先放在本项目目录内，并在 `ProjectTasks.md` 中挂路径。
- `Summary.md` 只保留高密度摘要，不堆运行细节；细节进 `docs/` 或 `ProjectTasks.md`。
>>>>>>> origin/main
