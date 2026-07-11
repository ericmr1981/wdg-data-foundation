import { getPool } from '../../db.js';
export function registerAdminTaskRoutes(app, scheduler) {
    app.addHook('preHandler', async (req, reply) => {
        if (!req.url.startsWith('/api/admin/'))
            return;
        const role = req.headers['x-wdg-user-role'];
        if (role !== 'admin')
            return reply.code(403).send({ error: 'forbidden' });
    });
    // GET 列表 (with 筛选)
    app.get('/api/admin/tasks', async (req) => {
        const { status, task_type, user_id, limit = '50' } = req.query;
        const conditions = [];
        const params = [];
        let i = 1;
        if (status) {
            conditions.push(`status = $${i++}`);
            params.push(status);
        }
        if (task_type) {
            conditions.push(`task_type = $${i++}`);
            params.push(task_type);
        }
        if (user_id) {
            conditions.push(`user_id = $${i++}`);
            params.push(user_id);
        }
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const { rows } = await getPool().query(`SELECT task_id, task_type, status, progress, user_id, conversation_id,
                parent_task_id, input, result, error,
                created_at, started_at, finished_at
         FROM agent.tasks ${where}
         ORDER BY created_at DESC
         LIMIT $${i}`, [...params, parseInt(limit, 10)]);
        return { success: true, tasks: rows };
    });
    // GET 详情
    app.get('/api/admin/tasks/:id', async (req, reply) => {
        const { rows } = await getPool().query(`SELECT * FROM agent.tasks WHERE task_id = $1`, [req.params.id]);
        if (!rows[0])
            return reply.code(404).send({ error: 'not found' });
        return { success: true, task: rows[0] };
    });
    // GET steps
    app.get('/api/admin/tasks/:id/steps', async (req) => {
        const { rows } = await getPool().query(`SELECT * FROM agent.task_steps WHERE task_id = $1 ORDER BY step_index`, [req.params.id]);
        return { success: true, steps: rows };
    });
    // POST cancel
    app.post('/api/admin/tasks/:id/cancel', async (req) => {
        await scheduler.cancel(req.params.id);
        return { success: true };
    });
    // POST retry (复制原 input 重新 enqueue)
    app.post('/api/admin/tasks/:id/retry', async (req, reply) => {
        const { rows } = await getPool().query(`SELECT task_type, input, user_id, conversation_id FROM agent.tasks WHERE task_id = $1`, [req.params.id]);
        if (!rows[0])
            return reply.code(404).send({ error: 'not found' });
        const newId = await scheduler.enqueue({
            taskType: rows[0].task_type,
            input: rows[0].input,
            triggeredBy: rows[0].user_id ?? 'admin-retry',
            conversationId: rows[0].conversation_id,
        });
        return { success: true, task_id: newId };
    });
    // POST enqueue
    app.post('/api/admin/tasks', async (req) => {
        const newId = await scheduler.enqueue({
            taskType: req.body.task_type,
            input: req.body.input,
            triggeredBy: req.body.triggeredBy ?? 'admin-manual',
        });
        return { success: true, task_id: newId };
    });
}
