import { createCoCanvasServer } from './server'
import { loadConfig } from './config'

const config = loadConfig()
const server = createCoCanvasServer({ host: config.host, port: config.port })

server.httpServer.once('listening', () => {
  console.log(`[cocanvas] ws 服务已启动: ws://${config.host}:${server.port}`)
  console.log(`[cocanvas] 健康检查: http://${config.host}:${server.port}/health`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\n[cocanvas] 收到 ${signal}，正在关闭…`)
    void server.close().then(() => process.exit(0))
  })
}
