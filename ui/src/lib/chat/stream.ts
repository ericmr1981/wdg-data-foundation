// ui/src/lib/chat/stream.ts
// SSE wire format: "event: <name>\ndata: <json>\n\n". Comments start with ":".

export type SseEvent = Record<string, unknown> & { type: string };

export function encodeSseEvent(evt: SseEvent): string {
  return `event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`;
}

/**
 * Streaming parser. Buffer chunks and split on the SSE record separator
 * (blank line). For each completed record, dispatch to `onEvent`.
 *
 * Keepalive lines (start with ':') are ignored. Multi-line `data:` is
 * joined with '\n' per the SSE spec.
 */
export function parseSseStream(
  chunk: string,
  onEvent: (evt: SseEvent) => void,
): void {
  // We rely on the producer emitting one record per chunk boundary in
  // practice (encodeSseEvent only emits one record at a time), but we
  // still split on the blank-line separator for safety.
  const records = chunk.split('\n\n');
  for (const rec of records) {
    const trimmed = rec.replace(/\n+$/, '');
    if (!trimmed) continue;
    const lines = trimmed.split('\n');
    let data = '';
    let eventName: string | null = null;
    for (const line of lines) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const field = line.slice(0, colon);
      let value = line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') eventName = value;
      else if (field === 'data') {
        data = data ? data + '\n' + value : value;
      }
    }
    if (!data) continue;
    try {
      const parsed = JSON.parse(data) as SseEvent;
      if (eventName) parsed.type = eventName;
      onEvent(parsed);
    } catch {
      // ignore malformed lines
    }
  }
}
