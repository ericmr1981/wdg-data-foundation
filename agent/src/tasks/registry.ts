// agent/src/tasks/registry.ts
import type { TaskHandler } from './types.js'

const handlers = new Map<string, TaskHandler>()

export function registerTaskHandler(type: string, handler: TaskHandler): void {
  handlers.set(type, handler)
}

export function getHandler(type: string): TaskHandler | null {
  return handlers.get(type) ?? null
}

export function listRegisteredTypes(): string[] {
  return [...handlers.keys()]
}
