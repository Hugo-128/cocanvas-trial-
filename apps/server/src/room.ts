import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness'
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync'
import type { WebSocket } from 'ws'
import {
  CLOSE_PROTOCOL_ERROR,
  PROTOCOL_AWARENESS,
  PROTOCOL_SYNC,
  extractAwarenessClientIDs,
} from '@cocanvas/protocol'

const WS_OPEN = 1

/**
 * 房间 = 一个内存 Y.Doc + Awareness + 该文档的全部连接。
 *
 * Phase 0 不落库：房间在最后一个连接断开时销毁（内容随进程存亡，
 * 这正是 Phase 1 PostgreSQL 持久化要解决的问题）。
 *
 * 可靠性分级（AGENTS.md 3.2）在此落地：
 * - 内容通道（sync 协议消息）：广播失败只记日志不丢消息——Yjs update
 *   本身带在消息里，客户端重连时会通过 step1/step2 全量对账补齐；
 * - 状态通道（awareness）：可丢可滞后，发送失败静默跳过。
 */
export class Room {
  readonly id: string
  readonly doc: Y.Doc
  readonly awareness: Awareness

  private readonly clients = new Set<WebSocket>()
  /** conn → 该连接上报过的 awareness clientID，断连时精准清理光标 */
  private readonly clientIdsByConn = new Map<WebSocket, Set<number>>()
  private readonly onEmpty: () => void
  private disposed = false

  constructor(id: string, onEmpty: () => void) {
    this.id = id
    this.onEmpty = onEmpty
    this.doc = new Y.Doc()
    this.awareness = new Awareness(this.doc)
    this.doc.on('update', this.handleDocUpdate)
    this.awareness.on('update', this.handleAwarenessUpdate)
  }

  get clientCount(): number {
    return this.clients.size
  }

  // ---------------------------------------------------------------- 连接生命周期

  addConnection(ws: WebSocket): void {
    this.clients.add(ws)
    this.clientIdsByConn.set(ws, new Set())
    // 主动下发 sync step1（与 y-websocket 服务端同款行为）：
    // 服务端持有文档状态，新连接先拿到服务端 state vector，
    // 客户端随后的 step2 回复即可补全双向差异。
    this.sendTo(ws, this.encodeSyncStep1())
  }

  removeConnection(ws: WebSocket): void {
    this.clients.delete(ws)
    const tracked = this.clientIdsByConn.get(ws)
    this.clientIdsByConn.delete(ws)
    if (tracked !== undefined && tracked.size > 0) {
      // 断连立即移除该连接贡献的光标状态并广播，不等 30s 超时
      removeAwarenessStates(this.awareness, [...tracked], 'disconnect')
    }
    if (this.clients.size === 0) {
      this.dispose()
    }
  }

  // ---------------------------------------------------------------- 消息处理

  handleMessage(ws: WebSocket, message: Uint8Array): void {
    const decoder = decoding.createDecoder(message)
    const encoder = encoding.createEncoder()
    let selector: number
    try {
      selector = decoding.readVarUint(decoder)
    } catch {
      ws.close(CLOSE_PROTOCOL_ERROR, 'decode failed')
      return
    }

    try {
      switch (selector) {
        case PROTOCOL_SYNC: {
          encoding.writeVarUint(encoder, PROTOCOL_SYNC)
          // readSyncMessage：step1 → 写 step2 回复；step2/update → 应用到房间文档
          readSyncMessage(decoder, encoder, this.doc, ws, (err) => {
            console.error(`[room ${this.id}] sync 错误:`, err.message)
          })
          if (encoding.length(encoder) > 1) {
            this.sendTo(ws, encoder)
          }
          break
        }
        case PROTOCOL_AWARENESS: {
          const update = decoding.readVarUint8Array(decoder)
          // 记录该连接上报的 clientID，供断连清理
          const tracked = this.clientIdsByConn.get(ws)
          if (tracked !== undefined) {
            for (const clientID of extractAwarenessClientIDs(update)) {
              tracked.add(clientID)
            }
          }
          // origin=ws：handleAwarenessUpdate 据此广播给其他连接
          applyAwarenessUpdate(this.awareness, update, ws)
          break
        }
        default:
          ws.close(CLOSE_PROTOCOL_ERROR, `unknown selector ${selector}`)
      }
    } catch (error) {
      console.error(`[room ${this.id}] 协议处理异常:`, error)
      try {
        ws.close(CLOSE_PROTOCOL_ERROR, 'protocol error')
      } catch {
        // 连接可能已断开，忽略
      }
    }
  }

  // ---------------------------------------------------------------- 广播

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    const except = asConnection(origin)
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, PROTOCOL_SYNC)
    writeUpdate(encoder, update)
    this.broadcast(encoder, except)
  }

  private handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    const changed = [...added, ...updated, ...removed]
    if (changed.length === 0) return
    const except = asConnection(origin)
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, PROTOCOL_AWARENESS)
    encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(this.awareness, changed))
    this.broadcast(encoder, except)
  }

  private broadcast(encoder: encoding.Encoder, except?: WebSocket): void {
    const data = encoding.toUint8Array(encoder)
    for (const client of this.clients) {
      if (client === except) continue
      this.sendBytes(client, data)
    }
  }

  private sendTo(ws: WebSocket, encoder: encoding.Encoder): void {
    this.sendBytes(ws, encoding.toUint8Array(encoder))
  }

  private sendBytes(ws: WebSocket, data: Uint8Array): void {
    if (ws.readyState !== WS_OPEN) return
    try {
      ws.send(data)
    } catch (error) {
      // 单个客户端发送失败不影响其他客户端；
      // 内容不丢：Yjs update 已内含在消息里，对方重连会全量对账补齐
      console.error(`[room ${this.id}] 发送失败:`, (error as Error).message)
    }
  }

  private encodeSyncStep1(): encoding.Encoder {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, PROTOCOL_SYNC)
    writeSyncStep1(encoder, this.doc)
    return encoder
  }

  // ---------------------------------------------------------------- 销毁

  /** 关闭房间内全部连接（服务端优雅停机用） */
  closeAllConnections(): void {
    for (const client of [...this.clients]) {
      try {
        client.close()
      } catch {
        // 连接可能已断开，忽略
      }
    }
  }

  // ---------------------------------------------------------------- 销毁

  private dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.doc.off('update', this.handleDocUpdate)
    this.awareness.off('update', this.handleAwarenessUpdate)
    // Awareness 内部有 setInterval，必须显式销毁，否则进程无法退出
    this.awareness.destroy()
    this.doc.destroy()
    this.clients.clear()
    this.clientIdsByConn.clear()
    this.onEmpty()
  }
}

/** origin 是 WebSocket 时说明消息来自某个客户端（广播时排除它） */
function asConnection(origin: unknown): WebSocket | undefined {
  if (origin !== null && typeof origin === 'object' && 'readyState' in origin) {
    return origin as WebSocket
  }
  return undefined
}
