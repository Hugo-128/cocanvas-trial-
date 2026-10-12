import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCoCanvasServer, type CoCanvasServer } from '@cocanvas/server'
import { CoCanvasProvider, buildRoomUrl } from '@cocanvas/protocol'

/**
 * 双客户端同步集成测试（Phase 0 验收项）。
 *
 * 关键点：这里跑的是**真实链路**——进程内启动自写 ws 服务端，
 * 两个 CoCanvasProvider 通过真实 WebSocket（Node 22 全局 WebSocket）连接，
 * 不是两个 Y.Doc 直接交换 update 的“假协同”。
 */

let server: CoCanvasServer
let baseUrl: string

beforeAll(async () => {
  server = createCoCanvasServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>((resolve) => {
    server.httpServer.once('listening', resolve)
  })
  baseUrl = `ws://127.0.0.1:${server.port}`
})

afterAll(async () => {
  await server.close()
})

function waitFor(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (condition()) {
        resolve()
        return
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`waitFor 超时（${timeoutMs}ms）`))
        return
      }
      setTimeout(tick, 20)
    }
    tick()
  })
}

const fastReconnect = { initialDelayMs: 20, maxDelayMs: 100 }

function connect(room: string): CoCanvasProvider {
  return new CoCanvasProvider({
    url: buildRoomUrl(baseUrl, room),
    reconnect: fastReconnect,
  })
}

describe('CoCanvasProvider × 自写服务端', () => {
  it('两个客户端实时双向同步，且最终收敛一致', async () => {
    const room = `sync-${Date.now().toString(36)}`
    const p1 = connect(room)
    const p2 = connect(room)

    try {
      await waitFor(() => p1.status === 'connected' && p2.status === 'connected')

      // A → B
      p1.doc.getText('body').insert(0, '你好 CRDT')
      await waitFor(() => p2.doc.getText('body').toString() === '你好 CRDT')

      // B → A
      p2.doc.getText('body').insert(p2.doc.getText('body').length, '，收敛')
      await waitFor(() => p1.doc.getText('body').toString() === '你好 CRDT，收敛')

      // 最终一致
      expect(p1.doc.getText('body').toString()).toBe(p2.doc.getText('body').toString())
    } finally {
      p1.destroy()
      p2.destroy()
    }
  })

  it('晚加入的客户端能拿到房间已有内容', async () => {
    const room = `late-${Date.now().toString(36)}`
    const p1 = connect(room)
    const p3 = connect(room)

    try {
      await waitFor(() => p1.status === 'connected' && p3.status === 'connected')
      p1.doc.getText('body').insert(0, '先来的内容')
      await waitFor(() => p3.doc.getText('body').toString() === '先来的内容')
    } finally {
      p1.destroy()
      p3.destroy()
    }
  })

  it('awareness 状态中继：对端能看到本地用户信息', async () => {
    const room = `aware-${Date.now().toString(36)}`
    const p1 = connect(room)
    const p2 = connect(room)

    try {
      await waitFor(() => p1.status === 'connected' && p2.status === 'connected')
      p1.awareness.setLocalStateField('user', {
        id: 'u1',
        name: '小明',
        color: '#ff0000',
      })
      await waitFor(() => {
        const state = p2.awareness.getStates().get(p1.doc.clientID) as
          | { user?: { name?: string } }
          | undefined
        return state?.user?.name === '小明'
      })
    } finally {
      p1.destroy()
      p2.destroy()
    }
  })

  it('断连即清 awareness：一端断开，对端光标立即消失', async () => {
    const room = `disc-${Date.now().toString(36)}`
    const p1 = connect(room)
    const p2 = connect(room)

    try {
      await waitFor(() => p1.status === 'connected' && p2.status === 'connected')
      p2.awareness.setLocalStateField('user', { id: 'u2', name: '小红', color: '#00ff00' })
      await waitFor(() => p1.awareness.getStates().has(p2.doc.clientID))

      p2.disconnect()
      await waitFor(() => !p1.awareness.getStates().has(p2.doc.clientID))
    } finally {
      p1.destroy()
      p2.destroy()
    }
  })

  it('离线编辑后重连自动合并：零丢字且收敛一致', async () => {
    const room = `offline-${Date.now().toString(36)}`
    const p1 = connect(room)
    const p2 = connect(room)

    try {
      await waitFor(() => p1.status === 'connected' && p2.status === 'connected')

      // p1 断线，两端各自编辑
      p1.disconnect()
      await waitFor(() => p1.status === 'disconnected')
      p1.doc.getText('body').insert(0, '离线输入')
      p2.doc.getText('body').insert(0, '对端输入')

      // p1 自动重连（指数退避已调小），双向对账合并
      await waitFor(() => p1.status === 'connected')
      await waitFor(() => p1.doc.getText('body').toString() === p2.doc.getText('body').toString())

      const merged = p1.doc.getText('body').toString()
      expect(merged).toContain('离线输入')
      expect(merged).toContain('对端输入')
      expect(merged).toBe(p2.doc.getText('body').toString())
    } finally {
      p1.destroy()
      p2.destroy()
    }
  })

  it('非法房间路径被服务端拒绝（close code 4001）', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/not-a-room`)
    const closeCode = await new Promise<number>((resolve, reject) => {
      ws.addEventListener('close', (event) => resolve(event.code))
      ws.addEventListener('error', () => reject(new Error('连接错误')))
      setTimeout(() => reject(new Error('等待 close 超时')), 5000)
    })
    expect(closeCode).toBe(4001)
  })
})
