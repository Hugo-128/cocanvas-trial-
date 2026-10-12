import type * as Y from 'yjs'

/** 客户端连接状态（UI 与自动化测试共用） */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

/** 协作者身份（awareness user 字段） */
export interface CoCanvasUser {
  id: string
  name: string
  color: string
}

/** CoCanvasProvider 构造参数 */
export interface CoCanvasProviderOptions {
  /** 房间 WebSocket 地址，如 ws://localhost:7001/room/<docId> */
  url: string
  /** 外部注入 Y.Doc（Phase 2 离线持久化时由 y-indexeddb 提供）；缺省新建 */
  doc?: Y.Doc
  /** 重连策略覆盖（测试中调小延迟） */
  reconnect?: Partial<import('./constants').ReconnectConfig>
  /** WebSocket 实现注入（测试可用替代实现）；缺省用全局 WebSocket */
  WebSocketImpl?: typeof WebSocket
  /** 状态变化回调 */
  onStatusChange?: (status: ConnectionStatus) => void
  /** 协议级错误回调（不抛出，避免崩溃） */
  onError?: (error: Error) => void
}

/** 房间地址工具：由基础地址 + docId 拼出房间 URL */
export function buildRoomUrl(baseUrl: string, docId: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  return `${base}/room/${encodeURIComponent(docId)}`
}
