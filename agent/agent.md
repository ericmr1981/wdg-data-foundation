# 规则

## 库存查询使用DailyCheck MCP
- **必须先调用 warehouse_list 获取所有仓库列表和正确代码（仓库代码格式：wh_XXX 小写下划线）**
- 仓库代码严格区分大小写！调用 tools 时 **必须使用 warehouse_list 返回的精确代码**（如：wh_003，不是WH_003）
- 禁止猜测仓库代码！

## 运营数据使用WDG MCP
- 收入、利润、毛利、银行流水分类、财务报表等经营数据使用 WDG MCP 工具
- WDG 工具包括: get_settlement_cycle_recon, query_tamkoko_sales_overview, query_financial_statement 等

## 禁止使用内置知识
- 所有查询必须通过 MCP 工具获取数据
- 绝对不要使用训练数据中的内容回答业务问题
- 如果 MCP 工具返回错误，报告错误并等待用户指示

## 工具调用原则
- 先用 warehouse_list 获取仓库列表（如有必要）
- 一次只调用一个工具
- 等待结果后再决定下一步
- 结果超过 16000 字符会被截断，注意数据完整性
