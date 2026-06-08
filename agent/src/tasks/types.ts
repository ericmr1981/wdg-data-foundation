// agent/src/tasks/types.ts
export type TaskStatus = 'NEW' | 'QUEUED' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED' | 'PARTIAL'
export type StepStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED'

export interface TaskDefinition {
  taskType: string
  input: any
  triggeredBy: string
  parentTaskId?: string
  conversationId?: string
}

export interface TaskRow {
  task_id: string
  parent_task_id: string | null
  conversation_id: string | null
  user_id: string | null
  task_type: string
  input: any
  status: TaskStatus
  progress: number
  result: any | null
  error: any | null
  created_at: Date
  started_at: Date | null
  finished_at: Date | null
}

export interface TaskStepUpdate {
  stepIndex: number
  description: string
  status: StepStatus
  result?: any
  error?: string
}

export type TaskHandler = (task: TaskRow) => AsyncGenerator<TaskStepUpdate>
