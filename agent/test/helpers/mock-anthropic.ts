// agent/test/helpers/mock-anthropic.ts
import Anthropic from '@anthropic-ai/sdk'

export interface MockResponse {
  text?: string
  toolCalls?: { name: string; input: any }[]
  thinking?: string
  error?: { code: number; message: string }
  usage?: { input_tokens: number; output_tokens: number }
}

export class MockAnthropic {
  responses: MockResponse[] = []
  callIndex = 0

  messages = {
    create: async (_params: any): Promise<any> => {
      const next = this.responses[this.callIndex++]
      if (!next) throw new Error('No more mock responses')
      if (next.error) {
        const err: any = new Error(next.error.message)
        err.status = next.error.code
        throw err
      }
      return {
        content: [
          ...(next.thinking ? [{ type: 'thinking', thinking: next.thinking }] : []),
          ...(next.text ? [{ type: 'text', text: next.text }] : []),
          ...(next.toolCalls?.map((tc, i) => ({
            type: 'tool_use', id: `tool_${i}`, name: tc.name, input: tc.input,
          })) ?? []),
        ],
        stop_reason: next.toolCalls ? 'tool_use' : 'end_turn',
        usage: next.usage ?? { input_tokens: 100, output_tokens: 50 },
      }
    },
  }

  reset() { this.responses = []; this.callIndex = 0 }
  pushResponse(r: MockResponse) { this.responses.push(r) }
}
