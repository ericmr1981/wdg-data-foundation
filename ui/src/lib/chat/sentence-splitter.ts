// Split a streaming assistant text buffer into sentence/paragraph blocks.
// Rules (priority order):
//   1. Triple-backtick fences (single-level) at line start are preserved as a
//      single block; leading prose on the same line stays attached.
//   2. Paragraph break \n\n splits blocks.
//   3. Sentence terminators (。！？.!? — any of them) flush the buffer; the
//      terminator stays with the preceding segment.
//   4. Whitespace-only fragments are dropped.
// Inline backticks (not at line start) are not treated as a fence — they
// remain in the buffer as plain text.

const TERMINATOR_CHARS = new Set(['。', '！', '？', '.', '!', '?']);

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

    if (TERMINATOR_CHARS.has(ch)) {
      flush();
    }
  }

  flush();
  return out;
}
