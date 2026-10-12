import { useEffect, useRef, useState } from 'react'
import { CoCanvasProvider, buildRoomUrl, type ConnectionStatus } from '@cocanvas/protocol'

const WS_BASE_URL: string =
  (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://127.0.0.1:7001'
// 默认用 127.0.0.1 而非 localhost：避免 localhost 解析到 ::1 时
// 服务端（默认只绑 127.0.0.1）连不上，也避开系统代理对 localhost 的歧义

export interface UseProviderResult {
  provider: CoCanvasProvider | null
  status: ConnectionStatus
}

/**
 * 为指定文档创建/销毁 provider。
 *
 * enabled=false 时不创建（如文档 ID 非法的场景，避免无意义的重连循环）。
 *
 * 注意：这里假设组件不会因 StrictMode 双重挂载而被创建两次
 * （main.tsx 有意未启用 StrictMode）。若将来启用，需要在这里做去重。
 */
export function useProvider(docId: string, enabled = true): UseProviderResult {
  const [provider, setProvider] = useState<CoCanvasProvider | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const statusRef = useRef(status)
  statusRef.current = status

  useEffect(() => {
    if (!enabled) return
    const instance = new CoCanvasProvider({
      url: buildRoomUrl(WS_BASE_URL, docId),
      onStatusChange: (next) => {
        statusRef.current = next
        setStatus(next)
      },
      onError: (error) => {
        console.error('[cocanvas] provider 错误:', error.message)
      },
    })
    setProvider(instance)
    setStatus(instance.status)
    return () => {
      instance.destroy()
      setProvider(null)
    }
  }, [docId, enabled])

  return { provider, status }
}
