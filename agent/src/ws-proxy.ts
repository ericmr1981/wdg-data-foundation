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
//
// 纯 stdlib + ws (PR #5 已引),不引新依赖。

import http from 'node:http'
import type { Duplex } from 'node:stream'

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const UI_HOST = '127.0.0.1'
const UI_PORT = parseInt(process.env.UI_PORT ?? '3001', 10)
const AGENT_WS_HOST = '127.0.0.1'
const AGENT_WS_PORT = parseInt(process.env.AGENT_WS_PORT ?? '4102', 10)

const log = (level: string, msg: string, extra?: object) => {
  const line = { level, time: new Date().toISOString(), msg, ...extra }
  console.log(JSON.stringify(line))
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
  })
  upstream.on('error', (err) => {
    log('error', 'http upstream error', { err: err.message, url: clientReq.url })
    clientRes.writeHead(502, { 'Content-Type': 'text/plain' })
    clientRes.end('bad gateway: ui upstream error\n')
  })
  clientReq.pipe(upstream)
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

// 3) 主 server
const server = http.createServer((req, res) => {
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
  log('info', 'wdg-ws-proxy listening', { port: PORT, ui: `${UI_HOST}:${UI_PORT}`, agentWs: `${AGENT_WS_HOST}:${AGENT_WS_PORT}` })
})

// 优雅关闭
const shutdown = (sig: string) => {
  log('info', 'shutting down', { sig })
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 5000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
