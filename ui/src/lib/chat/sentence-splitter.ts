// Split a streaming assistant text buffer into sentence/paragraph blocks.
// Rules (priority order):
//   1. Parentheses () and （） are kept intact — never split inside unclosed parens.
//   2. Markdown links [text](url) are kept intact — never split inside URL.
//   3. Triple-backtick fences (single-level) at line start are preserved as a
//      single block; leading prose on the same line stays attached.
//   4. Paragraph break \n\n splits blocks.
//   5. Table rows (lines starting with |) are kept together.
//   6. Sentence terminators (。！？!?) flush the buffer.
//      NOTE: `.` is deliberately NOT a terminator — it breaks URLs, numbers,
//      file extensions (.pdf/.xlsx), and markdown ordered lists (1. 2.).
//   7. Whitespace-only fragments are dropped.

const TERMINATOR_CHARS = new Set(['。', '！', '？', '!', '?']);

/** Check if text has unclosed parentheses — prevents splitting inside (xxx) or （xxx） */
function hasUnclosedParens(text: string): boolean {
  let open = 0, fullOpen = 0;
  for (const ch of text) {
    if (ch === '(') open++;
    else if (ch === ')') open = open > 0 ? open - 1 : 0;
    else if (ch === '（') fullOpen++;
    else if (ch === '）') fullOpen = fullOpen > 0 ? fullOpen - 1 : 0;
  }
  return open > 0 || fullOpen > 0;
}

/**
 * Find the end of a markdown link if we're at the `[` position.
 * Returns the index AFTER the closing `)` if a link [text](url) was found,
 * or -1 if this is not a link start.
 */
function findLinkEnd(input: string, start: number): number {
  // Must start with [
  if (input[start] !== '[') return -1;
  // Find matching ]
  const closeBracket = input.indexOf(']', start + 1);
  if (closeBracket === -1) return -1;
  // Must be immediately followed by (
  if (input[closeBracket + 1] !== '(') return -1;
  // Find matching ) — URLs can contain nested parens but that's rare;
  // find the first ) after the (
  const closeParen = input.indexOf(')', closeBracket + 2);
  if (closeParen === -1) return -1;
  // Validate: there must be non-empty content between [ and ], and between ( and )
  if (closeBracket === start + 1) return -1; // empty []
  if (closeParen === closeBracket + 2) return -1; // empty ()
  return closeParen + 1;
}

export function splitSentences(input: string): string[] {
  if (!input) return [];
  const out: string[] = [];
  let buf = '';
  let inFence = false;
  let inTable = false;
  let fenceStartBuf = '';

  const flush = () => {
    const trimmed = buf.trim();
    if (trimmed) out.push(trimmed);
    buf = '';
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    // Markdown link detection: [text](url) — consume as an atomic unit.
    // This prevents `.` inside URLs (export?...pdf) from breaking links.
    if (ch === '[' && !inFence && !inTable) {
      const linkEnd = findLinkEnd(input, i);
      if (linkEnd > i) {
        buf += input.slice(i, linkEnd);
        i = linkEnd - 1; // loop increment will set to linkEnd
        continue;
      }
    }

    // Table detection: lines starting with | are kept together
    const atLineStart = i === 0 || input[i - 1] === '\n';
    if (atLineStart && ch === '|' && !inFence) {
      if (!inTable) {
        flush();
        inTable = true;
      }
      buf += ch;
      i++;
      while (i < input.length && input[i] !== '\n') {
        buf += input[i];
        i++;
      }
      if (i < input.length) buf += input[i]; // the \n
      continue;
    }

    // End of table: line does NOT start with |, and we were in a table
    if (inTable && atLineStart && ch !== '|' && ch !== '`') {
      flush();
      inTable = false;
    }

    if (ch === '`' && input[i + 1] === '`' && input[i + 2] === '`') {
      if (atLineStart && !inFence) {
        fenceStartBuf = buf;
        buf = '';
        inFence = true;
        buf += '```';
        i += 2;
        const rest = input.slice(i + 1);
        const nlIdx = rest.indexOf('\n');
        if (nlIdx >= 0) {
          buf += rest.slice(0, nlIdx);
          i += nlIdx;
        }
        continue;
      }
      if (inFence) {
        buf += '```';
        i += 2;
        inFence = false;
        buf = fenceStartBuf + buf;
        fenceStartBuf = '';
        continue;
      }
    }

    if (inFence) {
      buf += ch;
      continue;
    }

    if (inTable) {
      buf += ch;
      continue;
    }

    if (ch === '\n' && input[i + 1] === '\n') {
      flush();
      i += 1;
      continue;
    }

    buf += ch;

    if (TERMINATOR_CHARS.has(ch) && !hasUnclosedParens(buf)) {
      flush();
    }
  }

  flush();
  return out;
}
