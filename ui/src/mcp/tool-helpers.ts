/**
 * Build a consistent description block for tool descriptions.
 */
export function descriptionBlock(title: string, lines: string[]): string {
  return `**${title}**:\n${lines.join('\n')}`;
}

/**
 * Normalize API JSON response for MCP tool return.
 * Handles { data, note } pattern and falls back to full object.
 */
export function normalizeQueryResponse<T = unknown>(json: unknown): T {
  if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>;
    if ('data' in obj && obj.data !== undefined) return obj.data as T;
    if ('note' in obj) return json as T;
  }
  return json as T;
}

/** Field names that can appear in both camelCase and snake_case */
const FIELD_ALIASES: Record<string, string[]> = {
  sourceFileId: ['sourceFileId', 'source_file_id'],
  fileName: ['fileName', 'file_name'],
  rowCount: ['rowCount', 'row_count'],
  unclassifiedThisFile: ['unclassifiedThisFile', 'unclassified_this_file'],
  unclassifiedThisBrandMonth: ['unclassifiedThisBrandMonth', 'unclassified_this_brand_month'],
  totalThisBrandMonth: ['totalThisBrandMonth', 'total_this_brand_month'],
  coveragePct: ['coveragePct', 'coverage_pct'],
  importError: ['importError', 'import_error'],
  fileId: ['fileId', 'file_id'],
};

/**
 * Normalize API responses with known field aliases from upload/post endpoints.
 * Maps snake_case to camelCase for consistent tool output.
 */
export function normalizeToolResponse(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const handled = new Set<string>();

  for (const [camelKey, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      if (alias in data) {
        out[camelKey] = data[alias];
        handled.add(alias);
        break;
      }
    }
  }

  // Copy remaining fields (already camelCase or unrecognized)
  for (const [key, value] of Object.entries(data)) {
    if (!handled.has(key)) {
      out[key] = value;
    }
  }

  return out;
}
