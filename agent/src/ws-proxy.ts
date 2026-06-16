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

// 2) WS upgrade 反代: 把 client upgrade 透明地传给 upstream
const proxyWs = (clientReq: http.IncomingMessage, clientSocket: Duplex, head: Buffer) => {
  const upstream = http.request({
    host: AGENT_WS_HOST,
    port: AGENT_WS_PORT,
    method: 'GET',
    path: clientReq.url,
    headers: clientReq.headers,
  })
  upstream.on('upgrade', (upRes, upSocket, upHead) => {
    // 拼 101 Switching Protocols 响应回给 client
    const headerLines: string[] = ['HTTP/1.1 101 Switching Protocols']
    for (const [k, v] of Object.entries(upRes.headers)) {
      const kl = k.toLowerCase()
      if (kl === 'upgrade' || kl === 'connection') continue
      headerLines.push(`${k}: ${v}`)
    }
    if (!Object.keys(upRes.headers).some((k) => k.toLowerCase() === 'upgrade')) {
      headerLines.push('Upgrade: websocket')
    }
    if (!Object.keys(upRes.headers).some((k) => k.toLowerCase() === 'connection')) {
      headerLines.push('Connection: Upgrade')
    }
    clientSocket.write(headerLines.join('\r\n') + '\r\n\r\n')
    if (upHead && upHead.length) clientSocket.write(upHead)
    // 双向 pipe
    upSocket.pipe(clientSocket)
    clientSocket.pipe(upSocket)
    log('info', 'ws upgraded', { url: clientReq.url })
  })
  upstream.on('error', (err) => {
    log('error', 'ws upstream error', { err: err.message, url: clientReq.url })
    clientSocket.destroy()
  })
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
