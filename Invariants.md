# Invariants｜WDG

## 项目级硬约束
- `ProjectTasks.md` 是项目状态、范围、决策、变更记录的单一真源；任何实质性改动都要同步更新。
- 不能把“部分完成”写成“已交付”；端到端未验收的能力只能标记为 `in_progress`。
- 不主动扩 scope；发现额外问题要记录，不顺手扩成另一个项目。

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

## 文档约束
- 新文件优先放在本项目目录内，并在 `ProjectTasks.md` 中挂路径。
- `Summary.md` 只保留高密度摘要，不堆运行细节；细节进 `docs/` 或 `ProjectTasks.md`。
