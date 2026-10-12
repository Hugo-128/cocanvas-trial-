/**
 * CoCanvas wire protocol 常量。
 *
 * ⚠️ 与 y-protocols 1.0.x 的关系：y-protocols 1.0.7 起只提供编解码原语
 * （sync 子类型常量、Awareness 编解码），不再提供 wire 层的消息选择器与
 * read/writeMessage 助手。因此外层协议选择器由本项目自定义——
 * 取值沿用 y-websocket 的既有约定（0=sync, 1=awareness），保证与生态兼容。
 *
 * 消息帧格式：
 *   [selector: varUint][payload]
 *   selector=0 → payload = [syncSubtype: varUint][data]（y-protocols/sync）
 *   selector=1 → payload = awarenessUpdate 二进制（y-protocols/awareness 的 encodeAwarenessUpdate）
 */

/** wire 协议选择器：Yjs sync 协议（内容通道） */
export const PROTOCOL_SYNC = 0
/** wire 协议选择器：awareness 协议（状态通道） */
export const PROTOCOL_AWARENESS = 1

/** WebSocket 关闭码：应用层错误区间（4000-4999） */
export const CLOSE_BAD_REQUEST = 4001
export const CLOSE_PROTOCOL_ERROR = 4002

/** 房间 ID 允许的字符与长度（防路径注入 / 滥用） */
export const DOC_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** 断线重连：指数退避 + 抖动（Phase 2 弱网场景的核心参数） */
export interface ReconnectConfig {
  /** 首次重连延迟 ms */
  initialDelayMs: number
  /** 重连延迟上限 ms */
  maxDelayMs: number
  /** 退避倍率 */
  factor: number
  /** 抖动比例 [0,1)，避免多客户端同步重连打爆服务端 */
  jitterRatio: number
}

export const DEFAULT_RECONNECT: ReconnectConfig = {
  initialDelayMs: 300,
  maxDelayMs: 15_000,
  factor: 2,
  jitterRatio: 0.3,
}
