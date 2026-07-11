import { getHandler } from './registry.js';
const POLL_INTERVAL_MS = 1000;
export class TaskScheduler {
    db;
    notifier;
    mcpBridge;
    workerCount;
    constructor(db, notifier, mcpBridge, workerCount = 4) {
        this.db = db;
        this.notifier = notifier;
        this.mcpBridge = mcpBridge;
        this.workerCount = workerCount;
        void this.mcpBridge; // unused for now, used by handlers via closure
    }
    start() {
        for (let i = 0; i < this.workerCount; i++) {
            this.workerLoop(i);
        }
    }
    async enqueue(def) {
        const { rows } = await this.db.query(`
      INSERT INTO agent.tasks
        (status, task_type, input, user_id, parent_task_id, conversation_id)
      VALUES ('QUEUED', $1, $2, $3, $4, $5)
      RETURNING task_id
    `, [def.taskType, JSON.stringify(def.input), def.triggeredBy, def.parentTaskId ?? null, def.conversationId ?? null]);
        return rows[0].task_id;
    }
    async workerLoop(_workerId) {
        while (true) {
            const task = await this.pickTask();
            if (!task) {
                await sleep(POLL_INTERVAL_MS);
                continue;
            }
            await this.runTask(task);
        }
    }
    async pickTask() {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            const { rows: picked } = await client.query(`
        SELECT task_id FROM agent.tasks
        WHERE status = 'QUEUED'
        ORDER BY created_at
        LIMIT 1
      `);
            if (picked.length === 0) {
                await client.query('COMMIT');
                return null;
            }
            const { rows } = await client.query(`
        UPDATE agent.tasks
        SET status = 'RUNNING', started_at = NOW()
        WHERE task_id = $1
        RETURNING *
      `, [picked[0].task_id]);
            await client.query('COMMIT');
            return rows[0] ?? null;
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    async runTask(task) {
        const handler = getHandler(task.task_type);
        if (!handler) {
            await this.failTask(task.task_id, `No handler for ${task.task_type}`);
            return;
        }
        let lastStepIndex = 0;
        let anyFailed = false;
        try {
            for await (const update of handler(task)) {
                lastStepIndex = update.stepIndex;
                await this.recordStep(task.task_id, update);
                await this.notifier.push({
                    type: 'task_update', conversationId: task.conversation_id,
                    payload: { taskId: task.task_id, step: update.stepIndex, status: update.status, description: update.description },
                });
                if (update.status === 'FAILED')
                    anyFailed = true;
            }
            await this.completeTask(task.task_id, lastStepIndex, anyFailed);
        }
        catch (e) {
            await this.failTask(task.task_id, e.message ?? String(e));
        }
    }
    async recordStep(taskId, update) {
        await this.db.query(`
      INSERT INTO agent.task_steps (task_id, step_index, description, status, started_at, finished_at, result, error)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (task_id, step_index) DO UPDATE SET
        status = EXCLUDED.status, finished_at = EXCLUDED.finished_at,
        result = EXCLUDED.result, error = EXCLUDED.error
    `, [
            taskId, update.stepIndex, update.description, update.status,
            update.status === 'RUNNING' ? new Date() : null,
            ['DONE', 'FAILED', 'SKIPPED'].includes(update.status) ? new Date() : null,
            update.result ? JSON.stringify(update.result) : null,
            update.error ?? null,
        ]);
    }
    async completeTask(taskId, lastStep, partial) {
        const status = partial ? 'PARTIAL' : 'DONE';
        await this.db.query(`
      UPDATE agent.tasks SET status = $2, progress = 100, result = $3, finished_at = NOW() WHERE task_id = $1
    `, [taskId, status, JSON.stringify({ lastStep, partial })]);
        await this.notifier.push({
            type: 'task_update', conversationId: null,
            payload: { taskId, status, lastStep },
        });
    }
    async failTask(taskId, errorMsg) {
        await this.db.query(`
      UPDATE agent.tasks SET status = 'FAILED', error = $2, finished_at = NOW() WHERE task_id = $1
    `, [taskId, JSON.stringify({ message: errorMsg })]);
        await this.notifier.push({
            type: 'task_update', conversationId: null,
            payload: { taskId, status: 'FAILED', error: errorMsg },
        });
    }
    async getStatus(taskId) {
        const { rows } = await this.db.query(`SELECT * FROM agent.tasks WHERE task_id = $1`, [taskId]);
        return rows[0] ?? null;
    }
    async cancel(taskId) {
        await this.db.query(`
      UPDATE agent.tasks SET status = 'CANCELLED', finished_at = NOW()
      WHERE task_id = $1 AND status IN ('QUEUED', 'RUNNING')
    `, [taskId]);
    }
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
