import { useEffect, useMemo, useState } from 'react'
import * as Y from 'yjs'
import { DOC_ID_PATTERN } from '@cocanvas/protocol'
import { getIdentity } from '../identity'
import { useProvider } from '../sync/useProvider'
import { CollabEditor } from '../editor/CollabEditor'
import type { CoCanvasUser } from '@cocanvas/protocol'

interface RecentDoc {
  id: string
  title: string
  at: number
}

const RECENT_KEY = 'cocanvas.recent'
const META_KEY = 'meta'
const TITLE_KEY = 'title'

function recordRecent(id: string, title: string): void {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const list = raw === null ? [] : (JSON.parse(raw) as RecentDoc[])
    const next: RecentDoc[] = [
      { id, title, at: Date.now() },
      ...list.filter((item) => item.id !== id),
    ].slice(0, 10)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // 忽略存储失败
  }
}

const STATUS_LABEL = {
  connecting: { text: '连接中…', className: 'badge connecting' },
  connected: { text: '已连接', className: 'badge connected' },
  disconnected: { text: '已断开 · 重连中', className: 'badge disconnected' },
} satisfies Record<string, { text: string; className: string }>

export default function EditorPage({ docId }: { docId: string }) {
  const valid = DOC_ID_PATTERN.test(docId)
  const user = useMemo<CoCanvasUser>(() => getIdentity(), [])
  const { provider, status } = useProvider(valid ? docId : '', valid)
  const [title, setTitle] = useState('')
  const [users, setUsers] = useState<CoCanvasUser[]>([])

  // 文档标题：存在 CRDT 里的 Y.Map('meta')，多端自动同步（无后端成本）
  useEffect(() => {
    if (provider === null) return
    const meta = provider.doc.getMap(META_KEY)
    const sync = () => setTitle(String(meta.get(TITLE_KEY) ?? ''))
    sync()
    meta.observe(sync)
    return () => meta.unobserve(sync)
  }, [provider])

  // 在线协作者列表（awareness 状态）
  useEffect(() => {
    if (provider === null) return
    const sync = () => {
      const list: CoCanvasUser[] = []
      provider.awareness.getStates().forEach((state, clientId) => {
        const u = (state as { user?: CoCanvasUser }).user
        if (u !== undefined) {
          list.push({ ...u, id: u.id ?? String(clientId) })
        }
      })
      setUsers(list)
    }
    sync()
    provider.awareness.on('change', sync)
    return () => provider.awareness.off('change', sync)
  }, [provider])

  // 记录到“最近文档”
  useEffect(() => {
    if (!valid) return
    recordRecent(docId, title)
    // title 变化时也刷新最近列表里的名字
  }, [docId, valid, title])

  useEffect(() => {
    document.title = title === '' ? `${docId} — CoCanvas` : `${title} — CoCanvas`
  }, [docId, title])

  if (!valid) {
    return (
      <main className="home">
        <h1>文档 ID 不合法</h1>
        <p className="hint">
          ID 只能包含字母、数字、- 和 _（1-64 字符）。
          <a href="#/"> 返回首页</a>
        </p>
      </main>
    )
  }

  const onTitleChange = (next: string) => {
    if (provider === null) return
    provider.doc.getMap(META_KEY).set(TITLE_KEY, next)
  }

  const badge = STATUS_LABEL[status] ?? STATUS_LABEL.connecting

  return (
    <div className="page">
      <header className="topbar">
        <a className="back" href="#/" aria-label="返回文档列表">
          ←
        </a>
        <input
          className="title-input"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="未命名文档"
          aria-label="文档标题"
        />
        <span className="doc-id" title="文档 ID">
          {docId}
        </span>
        <span className={badge.className}>{badge.text}</span>
        <span className="online" title="在线协作者">
          {users.map((u) => (
            <span
              key={u.id}
              className="avatar"
              style={{ backgroundColor: u.color }}
              data-name={u.name}
            >
              {u.name.slice(0, 1)}
            </span>
          ))}
        </span>
      </header>

      {provider === null ? (
        <main className="home">
          <p className="hint">正在连接协同服务…</p>
        </main>
      ) : (
        <CollabEditor provider={provider} user={user} />
      )}
    </div>
  )
}
