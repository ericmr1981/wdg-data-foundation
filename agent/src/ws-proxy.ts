// agent/src/ws-proxy.ts
//
// WDG 公网入口 (port 3000) 反代:
//   - 普通 HTTP 请求 → 127.0.0.1:3001 (next dev server, systemd wdg-ui)
//   - WebSocket upgrade → 127.0.0.1:4102 (agent WebChannel, systemd wdg-agent)
//
// 目的: 公网只暴露 3000 一个端口,内部 3001/4101/4102 全部 127.0.0.1 bind,
// 用户访问 http://112.124.18.246:3000/... 即可走通 UI + chat WS。
//
// 启动: 由 systemd wdg-ws-proxy.service 拉起,环境变量:
//   PORT          默认 3000
//   UI_PORT       默认 3001
//   AGENT_WS_PORT 默认 4102
//   ACCESS_LOG    可选,Apache combined log 路径,默认 /var/log/wdg/ws-proxy.access.log
//   DENY_PREFIXES 逗号分隔,默认 "u,api/chat"  — 这些前缀直接 403,不打 upstream
//
// 纯 stdlib + ws (PR #5 已引),不引新依赖。

import http from 'node:http'
import fs from 'node:fs'
import type { Duplex } from 'node:stream'

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const UI_HOST = '127.0.0.1'
const UI_PORT = parseInt(process.env.UI_PORT ?? '3001', 10)
const AGENT_WS_HOST = '127.0.0.1'
const AGENT_WS_PORT = parseInt(process.env.AGENT_WS_PORT ?? '4102', 10)
const ACCESS_LOG = process.env.ACCESS_LOG ?? '/var/log/wdg/ws-proxy.access.log'
const DENY_PREFIXES = (process.env.DENY_PREFIXES ?? 'u,api/chat')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const log = (level: string, msg: string, extra?: object) => {
  const line = { level, time: new Date().toISOString(), msg, ...extra }
  console.log(JSON.stringify(line))
}

// access log stream (combined format for fail2ban)
let accessLogStream: fs.WriteStream | null = null
try {
  // 父目录 /var/log/wdg 由 deploy/systemd/wdg-ws-proxy.service 的 RuntimeDirectory
  // 或预先 mkdir 创建;这里先尝试打开,失败也不影响主功能
  accessLogStream = fs.createWriteStream(ACCESS_LOG, { flags: 'a' })
  accessLogStream.on('error', (err) => {
    log('warn', 'access log write error', { err: err.message })
    accessLogStream = null
  })
} catch (err) {
  log('warn', 'access log open failed', { err: (err as Error).message })
}

const writeAccessLog = (entry: string) => {
  if (accessLogStream) accessLogStream.write(entry + '\n')
}

// 1) HTTP 反代: 把请求转发到 next dev (UI_PORT)
const proxyHttp = (clientReq: http.IncomingMessage, clientRes: http.ServerResponse) => {
  const upstream = http.request({
    host: UI_HOST,
    port: UI_PORT,
    method: clientReq.method,
    path: clientReq.url,
    headers: { ...clientReq.headers, host: `${UI_HOST}:${UI_PORT}` },
  })
  upstream.on('response', (upRes) => {
    clientRes.writeHead(upRes.statusCode ?? 502, upRes.headers)
    upRes.pipe(clientRes)
    writeAccessLog(formatAccessLine(clientReq, upRes.statusCode ?? 502, clientRes.getHeader('content-length') as string | undefined))
  })
  upstream.on('error', (err) => {
    log('error', 'http upstream error', { err: err.message, url: clientReq.url })
    clientRes.writeHead(502, { 'Content-Type': 'text/plain' })
    clientRes.end('bad gateway: ui upstream error\n')
    writeAccessLog(formatAccessLine(clientReq, 502, '0'))
  })
  clientReq.pipe(upstream)
}

// Apache combined log 格式 (CLF date: [17/Jun/2026:20:00:00 +0000]):
//   <ip> - <user> [<time>] "<method> <path> HTTP/1.1" <status> <size> "<referer>" "<ua>"
// 选 CLF 而不是 toUTCString() 是为了 fail2ban 自带 datepattern 兼容
// (nginx/apache 标准, 各类 log 工具都认)。
const formatAccessLine = (
  req: http.IncomingMessage,
  status: number,
  size: string | undefined,
): string => {
  const ip = (req.socket.remoteAddress ?? '-').replace(/^::ffff:/, '')
  const user = '-' // 无 auth
  const time = (() => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const day = pad(d.getUTCDate())
    const mon = d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })
    const year = d.getUTCFullYear()
    const hh = pad(d.getUTCHours())
    const mm = pad(d.getUTCMinutes())
    const ss = pad(d.getUTCSeconds())
    return `${day}/${mon}/${year}:${hh}:${mm}:${ss} +0000`
  })()
  const method = req.method ?? 'GET'
  const url = req.url ?? '-'
  const proto = 'HTTP/1.1'
  const referer = req.headers['referer'] ?? '-'
  const ua = req.headers['user-agent'] ?? '-'
  return `${ip} - ${user} [${time}] "${method} ${url} ${proto}" ${status} ${size ?? '-'} "${referer}" "${ua}"`
}

// 2) WS upgrade 反代:
//    把 client upgrade 透明地传给 upstream,
//    收到 upstream 101 响应后,直接 raw pipe 回来 —
//    用 socket.write(head) 把 upstream 给的 raw 字节直接转发,
//    避免手拼 header 出现重复/顺序/大小写问题。
const proxyWs = (clientReq: http.IncomingMessage, clientSocket: Duplex, head: Buffer) => {
  const upstream = http.request({
    host: AGENT_WS_HOST,
    port: AGENT_WS_PORT,
    method: 'GET',
    path: clientReq.url,
    // 转发必要的 upgrade 头,清掉 hop-by-hop 头(host, connection 等)
    headers: {
      ...clientReq.headers,
      host: `${AGENT_WS_HOST}:${AGENT_WS_PORT}`,
    },
  })
  upstream.on('upgrade', (upRes, upSocket, upHead) => {
    // Node http.request('upgrade') 文档: 'upgrade' 事件触发时,upRes.headers
    // 已包含 upstream 返回的 header (含 Sec-WebSocket-Accept)。
    // **但 raw status line + headers 字节没保留** — head 参数只包含 status line
    // 之后 / request line 之前的空 body (通常是空 buffer)。
    // 必须手拼 101 响应:status line + upstream 的 headers (除 hop-by-hop)。
    // 然后用 upSocket.pipe / clientSocket.pipe 双向转发。
    const lines: string[] = ['HTTP/1.1 101 Switching Protocols']
    const HEADER_SKIP = new Set(['connection', 'upgrade', 'keep-alive', 'transfer-encoding'])
    for (const [k, v] of Object.entries(upRes.headers)) {
      const kl = k.toLowerCase()
      if (HEADER_SKIP.has(kl)) continue
      const value = Array.isArray(v) ? v.join(', ') : String(v)
      lines.push(`${k}: ${value}`)
    }
    // 强制写入 Upgrade/Connection (某些 upstream 不带或大小写乱)
    lines.push('Upgrade: websocket')
    lines.push('Connection: Upgrade')
    clientSocket.write(lines.join('\r\n') + '\r\n\r\n')
    if (upHead && upHead.length) clientSocket.write(upHead)
    // 双向 pipe
    upSocket.pipe(clientSocket)
    clientSocket.pipe(upSocket)
    log('info', 'ws upgraded', { url: clientReq.url, headers: Object.keys(upRes.headers) })
    writeAccessLog(formatAccessLine(clientReq, 101, '0'))
  })
  upstream.on('error', (err) => {
    log('error', 'ws upstream error', { err: err.message, url: clientReq.url })
    clientSocket.destroy()
  })
  upstream.on('close', () => {
    if (!clientSocket.destroyed) clientSocket.destroy()
  })
  // 关键: end() 之前先发 upgrade 信号
  upstream.end()
}

// path 黑名单: 这些前缀路径是 WDG 内部路由,不应被外部未登录用户访问到
// (之前被 180.159.38.63 等扫描器打挂,SSR worker 被 hang 死,/login 卡 30s)
const isDenied = (url: string | undefined): string | null => {
  if (!url) return null
  // 跳过 query string
  const path = url.split('?')[0] ?? ''
  // 必须以 / 开头
  if (!path.startsWith('/')) return null
  for (const prefix of DENY_PREFIXES) {
    if (path === `/${prefix}` || path.startsWith(`/${prefix}/`)) {
      return prefix
    }
  }
  return null
}

// 3) 主 server
const server = http.createServer((req, res) => {
  const deniedPrefix = isDenied(req.url)
  if (deniedPrefix) {
    res.writeHead(403, { 'Content-Type': 'text/plain' })
    res.end(`forbidden: /${deniedPrefix}/* is not accessible from public entry\n`)
    log('warn', 'denied path', { prefix: deniedPrefix, url: req.url, ip: req.socket.remoteAddress })
    writeAccessLog(formatAccessLine(req, 403, '0'))
    return
  }
  proxyHttp(req, res)
})

server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/api/chat/ws')) {
    log('info', 'ws upgrade → agent', { url: req.url })
    proxyWs(req, socket, head)
  } else {
    log('warn', 'ws upgrade rejected (path not /api/chat/ws)', { url: req.url })
    socket.destroy()
  }
})

server.listen(PORT, '0.0.0.0', () => {
  log('info', 'wdg-ws-proxy listening', {
    port: PORT,
    ui: `${UI_HOST}:${UI_PORT}`,
    agentWs: `${AGENT_WS_HOST}:${AGENT_WS_PORT}`,
    accessLog: ACCESS_LOG,
    denyPrefixes: DENY_PREFIXES,
  })
})

// 优雅关闭
const shutdown = (sig: string) => {
  log('info', 'shutting down', { sig })
  server.close(() => {
    if (accessLogStream) accessLogStream.end()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 5000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
