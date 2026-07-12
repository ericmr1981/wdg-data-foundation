// Custom server: Next.js + WS proxy /ws → Agent ws://127.0.0.1:4102
// Lima gvproxy 会丢 WS data frame，所以不能让浏览器直连 4102。
// 浏览器走 /ws 路径通过 HTTP 端口 3001 进 VM，再由这个 proxy 转给 Agent。

const { createServer } = require('http')
const { parse } = require('url')
const next = require('next')
const httpProxy = require('http-proxy')

const dev = process.env.NODE_ENV !== 'production'
const hostname = process.env.HOST || '127.0.0.1'
const port = parseInt(process.env.PORT || '3001', 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

const wsProxy = httpProxy.createProxyServer({
  target: { host: '127.0.0.1', port: 4102 },
  ws: true,
})

wsProxy.on('error', (err) => {
  console.error('[ws-proxy] error:', err.message)
})

app.prepare().then(() => {
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url, true))
  })

  server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/ws')) {
      console.log('[ws-proxy] upgrade → ws://127.0.0.1:4102')
      wsProxy.ws(req, socket, head)
    }
  })

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port} (WS proxy /ws enabled)`)
  })
})
