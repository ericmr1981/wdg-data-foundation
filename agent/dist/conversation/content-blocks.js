// DB 行 → ContentBlock[] 重组器
// 对齐 Spec A.5.4 + 设计 §8
export function reconstructContentBlocks(row) {
    const c = row.content;
    // 未来兼容:若 SDK 直接写到 content jsonb 数组
    if (Array.isArray(c)) {
        return c;
    }
    // 旧形态:字符串 + 分列
    const blocks = [];
    // 容错:content 既不是字符串也不是数组(或 NULL)
    if (c !== null && c !== undefined && typeof c !== 'string') {
        return [{ type: 'text', text: '[unreadable message]' }];
    }
    if (row.thinking)
        blocks.push({ type: 'thinking', thinking: row.thinking });
    if (typeof c === 'string' && c.length > 0) {
        blocks.push({ type: 'text', text: c });
    }
    else if (c === null && !row.thinking && !row.tool_calls && !row.tool_results) {
        return [{ type: 'text', text: '[unreadable message]' }];
    }
    const tcs = Array.isArray(row.tool_calls) ? row.tool_calls : [];
    for (const tc of tcs) {
        if (tc && typeof tc === 'object' && tc.id && tc.name) {
            blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input ?? {} });
        }
    }
    const trs = Array.isArray(row.tool_results) ? row.tool_results : [];
    for (const tr of trs) {
        if (tr && typeof tr === 'object' && tr.tool_use_id) {
            blocks.push({
                type: 'tool_result',
                tool_use_id: tr.tool_use_id,
                content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content ?? ''),
                is_error: !!tr.is_error,
            });
        }
    }
    return blocks;
}
