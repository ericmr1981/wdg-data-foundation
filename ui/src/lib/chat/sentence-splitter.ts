// Split a streaming assistant text buffer into sentence/paragraph blocks.
// Rules (priority order):
//   1. Triple-backtick fences (single-level) at line start are preserved as a
//      single block; leading prose on the same line stays attached.
//   2. Paragraph break \n\n splits blocks.
//   3. Sentence terminators (。！？.!? — with a numeric-context exception for
//      `.` and `,`) flush the buffer; the terminator stays with the preceding
//      segment. The numeric exception prevents mid-number splits: a `.` or
//      `,` with a digit on either side is treated as a decimal point /
//      thousands separator, NOT a sentence end (e.g. "165,814.57 元" stays
//      together).
//   4. Whitespace-only fragments are dropped.
// Inline backticks (not at line start) are not treated as a fence — they
// remain in the buffer as plain text.

const TERMINATOR_CHARS = new Set(['。', '！', '？', '.', '!', '?']);
// `.` and `,` are sentence terminators ONLY when they are NOT flanked by
// digits. A "." between digits is a decimal point (16.66); a "," between
// digits is a thousands separator (165,814).
const NUMERIC_PUNCT = new Set(['.', ',']);

function isDigit(c: string | undefined): boolean {
  return !!c && c >= '0' && c <= '9';
}

/**
 * True iff `ch` at position `i` of `input` should be treated as a sentence
 * terminator (i.e. flush the buffer). Returns false for `.` / `,` between
 * digits so numeric data like "165,814.57 元" stays in one block.
 */
function isTerminator(ch: string, i: number, input: string): boolean {
  if (!TERMINATOR_CHARS.has(ch)) return false;
  if (NUMERIC_PUNCT.has(ch)) {
    const prev = i > 0 ? input[i - 1] : undefined;
    const next = i + 1 < input.length ? input[i + 1] : undefined;
    if (isDigit(prev) || isDigit(next)) return false;
  }
  return true;
}

export function splitSentences(input: string): string[] {
  if (!input) return [];
  const out: string[] = [];
  let buf = '';
  let inFence = false;
  let fenceStartBuf = '';

  const flush = () => {
    const trimmed = buf.trim();
    if (trimmed) out.push(trimmed);
    buf = '';
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (ch === '`' && input[i + 1] === '`' && input[i + 2] === '`') {
      const atLineStart = i === 0 || input[i - 1] === '\n';
      if (atLineStart && !inFence) {
        // Stash the buffer so leading prose on this line (e.g. "code:\n")
        // stays attached to the closed fence block at EOF.
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
        // Re-attach leading prose; do not flush yet so following text on the
        // same logical line stays in the block until a terminator/paragraph.
        buf = fenceStartBuf + buf;
        fenceStartBuf = '';
        continue;
      }
    }

    if (inFence) {
      buf += ch;
      continue;
    }

    if (ch === '\n' && input[i + 1] === '\n') {
      flush();
      i += 1;
      continue;
    }

    buf += ch;

    if (isTerminator(ch, i, input)) {
      flush();
    }
  }

  flush();
  return out;
}
