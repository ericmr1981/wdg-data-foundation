// Split a streaming assistant text buffer into sentence/paragraph blocks.
// Rules (priority order):
//   1. Code fences ```...``` (single-level) are preserved as a single block.
//   2. Paragraph break \n\n splits blocks.
//   3. Sentence terminators (。！？.!? plus optional trailing whitespace) split
//      blocks; the terminator stays with the preceding segment.
//   4. Whitespace-only fragments are dropped.
//   5. Any segment longer than 800 chars with no terminator is returned as-is
//      (prevents a giant bubble from a long code block).

const TERMINATORS = /([。！？\.!?])/g;
const MAX_BLOCK_CHARS = 800;

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
        // Start of a fence: prepend whatever was in buf (e.g. "code:\n") so
        // the fence block keeps its leading prose attached.
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
        // Re-attach leading prose to the closed fence block; do not flush
        // yet — let any following text on the same line stay in the block
        // until a paragraph break or terminator arrives.
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

    // Sentence-terminator split: any of 。！？.!? flushes the buffer.
    if (/[。！？\.!?]/.test(ch)) {
      flush();
    }
  }

  flush();
  return out;
}
