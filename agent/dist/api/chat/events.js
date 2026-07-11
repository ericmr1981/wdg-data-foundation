export function registerChatEventsRoutes(app, conversation) {
    app.get('/api/chat/conversations/:conversationId/events', async (req, reply) => {
        const after = req.query.after ?? '';
        const limit = Math.min(parseInt(req.query.limit ?? '100', 10) || 100, 500);
        const events = await conversation.getEvents(req.params.conversationId, after, limit);
        const last = events[events.length - 1];
        const latest = last ? last.id : after;
        return {
            events,
            has_more: events.length === limit,
            latest_event_id: latest,
        };
    });
}
