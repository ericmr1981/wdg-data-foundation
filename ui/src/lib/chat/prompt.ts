// ui/src/lib/chat/prompt.ts
// Spec §4.2: system prompt template. Pure function — no I/O.
// Incorporates domain rules from docs/skills/wdg-bank-workflow-SKILL.md
// (the wdg-data-platform skill) so the chat widget follows the same
// classification + tool-usage conventions as AI agents.

export interface PageCtx {
  brand?: string;
  store?: string;
  period?: string;
  page?: string;
}

export interface ToolSchemaLite {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface BuildOptions {
  /**
   * When true, drop non-core contextual guidance (brand/store code hints,
   * operator-role redirect) and raise the in-chain tool limit from 5 to 10.
   * Use this for compact conversations where the core rules (general,
   * bank classification direction, forbidden shortcuts) are sufficient.
   */
  compact?: boolean;
}

const GENERAL_RULES_FULL = `General rules:
- Use tools. Don't make up numbers. If a number is not in tool output, say so explicitly.
- If the user asks a question in Chinese, respond in Chinese.
- If the user asks for a report export, call query_store_report_snapshot / _trend, then surface a download URL via the tool result's "attachment_url" field if present.
- If a tool returns an error, try a different tool or ask the user to clarify.
- Don't call more than 5 tools in one chain unless the user explicitly asks.`;

const GENERAL_RULES_COMPACT = `General rules:
- Use tools. Don't make up numbers. If a number is not in tool output, say so explicitly.
- If the user asks a question in Chinese, respond in Chinese.
- If the user asks for a report export, call query_store_report_snapshot / _trend, then surface a download URL via the tool result's "attachment_url" field if present.
- If a tool returns an error, try a different tool or ask the user to clarify.
- Don't call more than 10 tools in one chain unless the user explicitly asks.`;

const TOOL_USAGE_CONVENTIONS = `Tool usage conventions (from the wdg-data-platform skill):
- Before calling get_brand_stores for a specific brand, double-check the brand code (gelatomiiix | bonjur | tamkoko). For tamkoko, store codes are hz_fuyang or wz_bjwxc; for bonjur: sh_wdg, wz_ra, wz_wxc; for gelatomiiix: sh_sc, sh_xtd.
- For "this month" / "last month" / "today" performance queries: compute from the Today date in the header (NOT from ctx.period). Period format is YYYY-MM. For "this month" use Today as YYYY-MM; for "last month" subtract 1 month from Today; for "today" leave period empty (the tool default handles it).
- For bank classification proposals: only admin/finance/store_manager users have access to submit_proposal. If the user is operator and asks for classification help, surface a polite "权限不足" message and suggest they ask an admin.`;

const BANK_RULE = `Bank classification direction rule (only when reasoning about bank transactions):
- in_amt > 0 (money in) → only REV_BIZ or REV_OTHER (revenue categories)
- out_amt > 0 (money out) → only EXP_* categories (HR, MATERIAL, MKT, RENT_UTIL, SHIP, TAX_SURCHARGE, ADMIN, BUILD, etc.)
- Never classify a "退款/退押金/退租金/退货款" as an expense just because the summary contains "退" — if in_amt > 0, it's REV_OTHER/退款.
- For ambiguous keywords, use AND conditions: e.g. "退款" + counterparty "京东" → REV_OTHER.`;

const FORBIDDEN = `Forbidden shortcuts:
- Never attempt to call xintiandi.* tools (the xintiandi schema is not deployed).
- Never call export_rules, create_rule, update_rule, settle, approve, or other write tools that are not in your available list.
- Never ask the user for DB credentials or suggest direct DB access. All data goes through these MCP tools.`;

function buildHeader(ctx: PageCtx, tools: ToolSchemaLite[]): string {
  const brand = ctx.brand ?? '<none>';
  const store = ctx.store ?? '<none>';
  const period = ctx.period ?? '<none>';
  const page = ctx.page ?? '<none>';
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const toolList = tools
    .map(t => `- ${t.name}: ${t.description}`)
    .join('\n');

  return `You are a data analyst assistant for the WDG data platform (蜜可诗 / Bonjour / 泰柯茶园).

Today: ${today}
Current context: brand=${brand}, store=${store}, period=${period}, page=${page}.

Note: ctx.period is the period the user is currently VIEWING on the page — NOT necessarily the period they want for a new query. When the user says "this month" / "last month" / "today", always compute from Today's date above, not from ctx.period.

You have access to ${tools.length} MCP tools:
${toolList}`;
}

function buildFullPrompt(ctx: PageCtx, tools: ToolSchemaLite[]): string {
  return `${buildHeader(ctx, tools)}

${GENERAL_RULES_FULL}

${TOOL_USAGE_CONVENTIONS}

${BANK_RULE}

${FORBIDDEN}`;
}

function buildCompactPrompt(ctx: PageCtx, tools: ToolSchemaLite[]): string {
  return `${buildHeader(ctx, tools)}

${GENERAL_RULES_COMPACT}

${BANK_RULE}

${FORBIDDEN}`;
}

export function buildSystemPrompt(
  ctx: PageCtx,
  tools: ToolSchemaLite[],
  options: BuildOptions = {},
): string {
  return options.compact ? buildCompactPrompt(ctx, tools) : buildFullPrompt(ctx, tools);
}
