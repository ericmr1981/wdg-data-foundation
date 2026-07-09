// agent/src/api/chat/upload.ts
// Files API — Portal 调这里把附件 upload 到 Anthropic,拿到 file_id 后填 user.message.attachments
//
// 流程: Portal 上传 multipart → agent 调 anthropic.beta.files.create → 返 {file_id, filename, mime_type, size}
// Portal 拿 file_id 后,在 user.message.attachments 里引用。
//
// 50MB cap + mime whitelist;超限返 file_too_large / unsupported_mime。
import type { FastifyInstance } from 'fastify'
import Anthropic from '@anthropic-ai/sdk'

const MAX_SIZE = 50 * 1024 * 1024  // 50MB
const ALLOWED_MIME = new Set([
  'application/pdf', 'text/plain', 'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
])

export async function registerChatUploadRoutes(app: FastifyInstance, anthropic: Anthropic) {
  app.post('/api/chat/upload', async (req, reply) => {
    // multipart 解析 — 用 @fastify/multipart
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'no_file' })

    const buf = await data.toBuffer()
    if (buf.length > MAX_SIZE) {
      return reply.code(413).send({ error: 'file_too_large', limit_bytes: MAX_SIZE })
    }
    if (!ALLOWED_MIME.has(data.mimetype)) {
      return reply.code(415).send({ error: 'unsupported_mime', mime: data.mimetype })
    }

    try {
      const file = await anthropic.beta.files.upload({
        file: new Blob([new Uint8Array(buf)], { type: data.mimetype }) as any,
      })
      return reply.send({
        file_id: file.id,
        filename: data.filename,
        mime_type: data.mimetype,
        size: buf.length,
      })
    } catch (e: any) {
      const code = e?.status === 413 ? 'file_too_large' : 'unknown'
      req.log.error({ err: e }, 'files.create failed')
      return reply.code(e?.status ?? 500).send({ error: code, message: e?.message })
    }
  })
}