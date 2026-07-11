export function registerAdminCronRoutes(app, cronChannel) {
    app.addHook('preHandler', async (req, reply) => {
        if (!req.url.startsWith('/api/admin/'))
            return;
        const role = req.headers['x-wdg-user-role'];
        if (role !== 'admin')
            return reply.code(403).send({ error: 'forbidden' });
    });
    app.get('/api/admin/cron', async () => {
        return { success: true, schedules: cronChannel.entries };
    });
}
