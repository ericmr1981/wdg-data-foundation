const MAX_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_MIME = new Set([
    'application/pdf', 'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
]);
export async function registerChatUploadRoutes(app, anthropic) {
    app.post('/api/chat/upload', async (req, reply) => {
        // multipart 解析 — 用 @fastify/multipart
        const data = await req.file();
        if (!data)
            return reply.code(400).send({ error: 'no_file' });
        const buf = await data.toBuffer();
        if (buf.length > MAX_SIZE) {
            return reply.code(413).send({ error: 'file_too_large', limit_bytes: MAX_SIZE });
        }
        if (!ALLOWED_MIME.has(data.mimetype)) {
            return reply.code(415).send({ error: 'unsupported_mime', mime: data.mimetype });
        }
        try {
            const file = await anthropic.beta.files.upload({
                file: new Blob([new Uint8Array(buf)], { type: data.mimetype }),
            });
            return reply.send({
                file_id: file.id,
                filename: data.filename,
                mime_type: data.mimetype,
                size: buf.length,
            });
        }
        catch (e) {
            const code = e?.status === 413 ? 'file_too_large' : 'unknown';
            req.log.error({ err: e }, 'files.upload failed');
            return reply.code(e?.status ?? 500).send({ error: code, message: e?.message });
        }
    });
}
