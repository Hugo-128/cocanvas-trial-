import * as Y from 'yjs'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness'
import { readSyncMessage, writeSyncStep1, writeUpdate } from 'y-protocols/sync'
import { DEFAULT_RECONNECT, PROTOCOL_AWARENESS, PROTOCOL_SYNC } from './constants'
import type { ReconnectConfig } from './constants'
import type { CoCanvasProviderOptions, ConnectionStatus } from './types'

const WS_OPEN = 1

/**
 * CoCanvas 参考客户端 provider。
 *
 * 职责（自研部分，Yjs 库不覆盖的层）：
 * - WebSocket 连接管理：指数退避 + 抖动重连
 * - wire 协议组装：y-protocols 1.0.x 只给编解码原语，外层帧格式在这里定义
 * - 内容通道与状态通道分流：doc update 走 sync 协议，awareness 走 awareness 协议
 * - 断线期间的语义：编辑不丢（重连后由 sync step1/step2 双向对账合并），
 *   但 awareness 中间态直接丢弃（符合双通道可靠性分级，见 AGENTS.md 3.2）
 *
 * 不负责：Y.Doc 的本地持久化（Phase 2 y-indexeddb 接入点：构造时注入 doc）。
 */
export class CoCanvasProvider {
  readonly doc: Y.Doc
  readonly awareness: Awareness

  /** 当前连接状态 */
  status: ConnectionStatus = 'connecting'

  private readonly url: string
  private readonly reconnectConfig: ReconnectConfig
  private readonly WebSocketImpl: typeof WebSocket
  private readonly onStatusChange?: (status: ConnectionStatus) => void
  private readonly onError?: (error: Error) => void

  private ws: WebSocket | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  /** 是否拥有 doc/awareness 的生命周期（注入的不负责销毁） */
  private readonly ownsDoc: boolean
  /** 出站内容按住开关（中文输入法 composition 期间用，见 setContentHold） */
  private contentHold = false
  /** 按住期间积压的 doc update，释放时合并为一条发送 */
  private pendingUpdates: Uint8Array[] = []

  constructor(options: CoCanvasProviderOptions) {
    this.url = options.url
    this.doc = options.doc ?? new Y.Doc()
    this.ownsDoc = options.doc === undefined
    this.awareness = new Awareness(this.doc)
    this.reconnectConfig = { ...DEFAULT_RECONNECT, ...options.reconnect }
    this.WebSocketImpl = options.WebSocketImpl ?? ((globalThis as { WebSocket?: typeof WebSocket }).WebSocket as typeof WebSocket)
    this.onStatusChange = options.onStatusChange
    this.onError = options.onError

    if (!this.WebSocketImpl) {
      throw new Error('CoCanvasProvider: 环境缺少全局 WebSocket，请通过 WebSocketImpl 注入')
    }

    this.doc.on('update', this.handleDocUpdate)
    this.awareness.on('update', this.handleAwarenessUpdate)

    this.connect()
  }

  // ---------------------------------------------------------------- 连接管理

  private connect(): void {
    if (this.disposed) return
    this.setStatus(this.reconnectAttempts === 0 ? 'connecting' : 'connecting')

    let ws: WebSocket
    try {
      ws = new this.WebSocketImpl(this.url)
    } catch (error) {
      this.onError?.(error instanceof Error ? error : new Error(String(error)))
      // URL 非法等不可恢复错误：不进入重连循环
      this.setStatus('disconnected')
      return
    }
    this.ws = ws
    ws.binaryType = 'arraybuffer'

    ws.addEventListener('open', this.handleOpen)
    ws.addEventListener('message', this.handleMessage)
    ws.addEventListener('close', this.handleClose)
    ws.addEventListener('error', this.handleError)
  }

  private handleOpen = (): void => {
    this.reconnectAttempts = 0
    this.setStatus('connected')

    // 客户端主动发起 sync step1（state vector），服务端回 step2（我们缺失的增量）
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, PROTOCOL_SYNC)
    writeSyncStep1(encoder, this.doc)
    this.send(encoder)

    // 重连后立即广播一次自己的 awareness 状态，
    // 否则断线期间的本地状态变更对方看不到（对端只在状态变化时收到推送）
    this.announceAwareness()
  }

  private handleMessage = (event: MessageEvent<ArrayBuffer>): void => {
    const data = new Uint8Array(event.data)
    const decoder = decoding.createDecoder(data)
    const encoder = encoding.createEncoder()
    let selector: number
    try {
      selector = decoding.readVarUint(decoder)
    } catch (error) {
      this.onError?.(error instanceof Error ? error : new Error(String(error)))
      return
    }

    switch (selector) {
      case PROTOCOL_SYNC: {
        encoding.writeVarUint(encoder, PROTOCOL_SYNC)
        try {
          // readSyncMessage 会把「对 step1 的 step2 回复」写进 encoder
          readSyncMessage(decoder, encoder, this.doc, this, (err) => this.onError?.(err))
        } catch (error) {
          this.onError?.(error instanceof Error ? error : new Error(String(error)))
          return
        }
        // 有回复内容才回发（length>1 表示除 selector 外还有数据）
        if (encoding.length(encoder) > 1) {
          this.send(encoder)
        }
        break
      }
      case PROTOCOL_AWARENESS: {
        try {
          const update = decoding.readVarUint8Array(decoder)
          applyAwarenessUpdate(this.awareness, update, this)
        } catch (error) {
          this.onError?.(error instanceof Error ? error : new Error(String(error)))
        }
        break
      }
      default:
        this.onError?.(new Error(`未知协议选择器: ${selector}`))
    }
  }

  private handleClose = (): void => {
    this.ws = null
    if (this.disposed) return
    this.setStatus('disconnected')
    this.scheduleReconnect()
  }

  private handleError = (): void => {
    // WebSocket error 之后必然跟随 close，重连在 close 里调度；
    // 这里只做可观测性上报，避免未捕获异常炸掉页面
    this.onError?.(new Error(`WebSocket 连接错误: ${this.url}`))
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return
    const { initialDelayMs, maxDelayMs, factor, jitterRatio } = this.reconnectConfig
    const exponential = Math.min(initialDelayMs * factor ** this.reconnectAttempts, maxDelayMs)
    const jitter = exponential * jitterRatio * Math.random()
    const delay = exponential + jitter
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  // ---------------------------------------------------------------- 出站消息

  /**
   * 按住/释放出站内容更新（中文输入法 composition 期间的关键机制）。
   *
   * 背景：ProseMirror 在 composition 期间会把拼音中间态作为普通交易应用，
   * y-prosemirror 没有 composition 保护，会把它写进 CRDT 并广播——
   * 远端客户端会看到拼音字母闪烁（AGENTS.md 6.4 高危坑）。
   *
   * 做法：composition 期间按住出站 update；结束后把积压的 update 用
   * Y.mergeUpdates 合并成一条发出。远端对一个 update 是原子应用，
   * 中间态（插入拼音+删除拼音）净效果相互抵消，只会渲染最终提交态。
   *
   * 注意：这是网络层修复，本地 CRDT 历史里仍有中间 op（由 Phase 4
   * 快照压缩兜底）；真正做到 CRDT 零污染需要 patch y-prosemirror。
   */
  setContentHold(held: boolean): void {
    if (this.contentHold === held) return
    this.contentHold = held
    if (!held) {
      this.flushPendingUpdates()
    }
  }

  private flushPendingUpdates(): void {
    if (this.pendingUpdates.length === 0) return
    // mergeUpdates 幂等合并（单个 update 也走同一路径，省掉下标访问的类型麻烦）
    const merged = Y.mergeUpdates(this.pendingUpdates)
    this.pendingUpdates = []
    if (!this.isOpen()) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, PROTOCOL_SYNC)
    writeUpdate(encoder, merged)
    this.send(encoder)
  }

  private handleDocUpdate = (update: Uint8Array, origin: unknown): void => {
    // origin === this 表示来自网络的回包，不回灌
    if (origin === this) return
    if (this.contentHold) {
      // composition 期间：积压，稍后合并发送
      this.pendingUpdates.push(update)
      return
    }
    if (!this.isOpen()) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, PROTOCOL_SYNC)
    writeUpdate(encoder, update)
    this.send(encoder)
  }

  private handleAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    // 远端 awareness 的回包不再转发（由服务端向其他客户端广播）
    if (origin === this) return
    if (!this.isOpen()) return
    const changed = [...added, ...updated, ...removed]
    if (changed.length === 0) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, PROTOCOL_AWARENESS)
    encoding.writeVarUint8Array(encoder, encodeAwarenessUpdate(this.awareness, changed))
    this.send(encoder)
  }

  private announceAwareness(): void {
    if (!this.isOpen()) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, PROTOCOL_AWARENESS)
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate(this.awareness, [this.doc.clientID]),
    )
    this.send(encoder)
  }

  private send(encoder: encoding.Encoder): void {
    if (!this.isOpen()) return
    this.ws?.send(encoding.toUint8Array(encoder))
  }

  private isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WS_OPEN
  }

  // ---------------------------------------------------------------- 生命周期

  /** 主动断开当前连接（将按退避策略自动重连；UI 可做“重新连接”按钮） */
  disconnect(): void {
    if (this.ws !== null) {
      this.ws.close()
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return
    this.status = status
    this.onStatusChange?.(status)
  }

  destroy(): void {
    if (this.disposed) return
    this.disposed = true
    this.pendingUpdates = []
    this.contentHold = false
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.doc.off('update', this.handleDocUpdate)
    this.awareness.off('update', this.handleAwarenessUpdate)
    if (this.ws !== null) {
      this.ws.removeEventListener('open', this.handleOpen)
      this.ws.removeEventListener('message', this.handleMessage)
      this.ws.removeEventListener('close', this.handleClose)
      this.ws.removeEventListener('error', this.handleError)
      this.ws.close()
      this.ws = null
    }
    this.awareness.destroy()
    if (this.ownsDoc) {
      this.doc.destroy()
    }
  }
}
