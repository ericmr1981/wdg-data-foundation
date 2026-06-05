// ui/src/lib/chat/auth.ts
// Spec §5: write allowlist + role-based tool filtering.

/**
 * The role used for chat tool filtering. Mirrors `UserRole` from
 * `@/lib/auth-server` (plus `null` for the "not logged in" case).
 * If a new role is added to `UserRole`, update this type too.
 */
export type ChatUserRole = 'admin' | 'operator' | null;

export const ALLOWED_WRITE_TOOLS: Set<string> = new Set([
  'upload_bank_txn_file',
  'upload_gelatomiiix_income_detail',
  'upload_bonjur_income_detail',
  'upload_bonjur_product_sales',
  'upload_bonjur_sales_self_service',
  'upload_tamkoko_inventory',
  'submit_approval_proposal',
  'rerun_match_by_file',
]);

export function filterToolsByRole<T extends { name: string }>(
  role: ChatUserRole,
  tools: T[],
): T[] {
  if (role === 'admin') return tools;
  // operator or null: strip the 8 write tools.
  return tools.filter(t => !ALLOWED_WRITE_TOOLS.has(t.name));
}

export function isWriteAllowedForRole(role: ChatUserRole, toolName: string): boolean {
  return role === 'admin' && ALLOWED_WRITE_TOOLS.has(toolName);
}
