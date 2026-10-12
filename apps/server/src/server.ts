import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { WebSocketServer, type WebSocket } from 'ws'
import { Room } from './room'
import { CLOSE_BAD_REQUEST, DOC_ID_PATTERN } from '@cocanvas/protocol'

export interface CoCanvasServerOptions {
  host?: string
  /** 传 0 时由操作系统分配端口（测试用） */
  port?: number
}

export interface CoCanvasServer {
  httpServer: Server
  wss: WebSocketServer
  /** 实际监听端口（listening 后才可用） */
  readonly port: number
  /** 房间数量（测试/运维观测用） */
  readonly roomCount: number
  close(): Promise<void>
}

const ROOM_PATH = /^\/room\/([A-Za-z0-9_-]{1,64})$/

/**
 * 创建 CoCanvas 协同服务端。
 *
 * 自写 ws 服务（不用 y-websocket 示例 server，AGENTS.md 红线 1）：
 * - 路由：/room/<docId>，docId 受 DOC_ID_PATTERN 约束
 * - HTTP：/health 健康检查（运维与 compose healthcheck 用）
 * - 房间：首个连接创建，最后一个连接断开销毁（Phase 0 无持久化）
 */
export function createCoCanvasServer(options: CoCanvasServerOptions = {}): CoCanvasServer {
  const host = options.host ?? '127.0.0.1'
  const requestedPort = options.port ?? 7001
  const rooms = new Map<string, Room>()

  const httpServer = createServer((req, res) => {
    const url = req.url ?? '/'
    if (url === '/health' || url.startsWith('/health?')) {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('cocanvas ws server')
  })

  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (ws: WebSocket, req) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname
    const docId = ROOM_PATH.exec(path)?.[1]
    if (docId === undefined || !DOC_ID_PATTERN.test(docId)) {
      ws.close(CLOSE_BAD_REQUEST, 'expected /room/<docId>')
      return
    }

    let room = rooms.get(docId)
    if (room === undefined) {
      room = new Room(docId, () => {
        rooms.delete(docId)
        console.log(`[room ${docId}] 空房间已销毁`)
      })
      rooms.set(docId, room)
      console.log(`[room ${docId}] 创建`)
    }
    const currentRoom = room

    currentRoom.addConnection(ws)
    console.log(`[room ${docId}] 客户端接入，当前 ${currentRoom.clientCount} 人在线`)

    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        ws.close(4002, 'binary frames only')
        return
      }
      currentRoom.handleMessage(ws, toUint8Array(data))
    })

    ws.on('close', () => {
      currentRoom.removeConnection(ws)
      if (rooms.has(docId)) {
        console.log(`[room ${docId}] 客户端离开，剩余 ${currentRoom.clientCount} 人在线`)
      }
    })

    ws.on('error', (error) => {
      console.error(`[room ${docId}] ws 错误:`, error.message)
    })
  })

  let address: AddressInfo | null = null
  httpServer.on('listening', () => {
    address = httpServer.address() as AddressInfo
  })
  httpServer.listen(requestedPort, host)

  return {
    httpServer,
    wss,
    get port() {
      if (address === null) {
        throw new Error('server 尚未 listening，port 不可用')
      }
      return address.port
    },
    get roomCount() {
      return rooms.size
    },
    close() {
      return new Promise<void>((resolve) => {
        for (const room of [...rooms.values()]) {
          room.closeAllConnections()
        }
        wss.close(() => {
          httpServer.close(() => resolve())
        })
      })
    },
  }
}

/** ws 的 RawData（Buffer | ArrayBuffer | Buffer[]）统一转 Uint8Array */
function toUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (Array.isArray(data)) {
    const total = data.reduce((sum, part) => sum + part.length, 0)
    const out = new Uint8Array(total)
    let offset = 0
    for (const part of data) {
      out.set(part, offset)
      offset += part.length
    }
    return out
  }
  throw new Error('无法识别的 ws 消息类型')
}
