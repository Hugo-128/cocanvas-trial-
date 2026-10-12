import * as decoding from 'lib0/decoding'

/**
 * 从 awareness update 二进制中提取涉及的 clientID 列表。
 *
 * 服务端用它跟踪「每个 WebSocket 连接上报过哪些 clientID」，
 * 连接断开时精准移除这些客户端的光标（不等 30s 超时）。
 *
 * 帧格式（y-protocols/awareness 的 encodeAwarenessUpdate 输出）：
 *   [count: varUint] × count: [clientID: varUint][clock: varUint][stateJSON: varString]
 */
export function extractAwarenessClientIDs(update: Uint8Array): number[] {
  const decoder = decoding.createDecoder(update)
  const count = decoding.readVarUint(decoder)
  const clientIDs: number[] = []
  for (let i = 0; i < count; i++) {
    const clientID = decoding.readVarUint(decoder)
    decoding.readVarUint(decoder) // clock
    decoding.readVarString(decoder) // state JSON
    clientIDs.push(clientID)
  }
  return clientIDs
}
