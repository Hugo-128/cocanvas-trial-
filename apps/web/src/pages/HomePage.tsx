import { useEffect, useState } from 'react'
import { randomDocId } from '../identity'

interface RecentDoc {
  id: string
  title: string
  at: number
}

const RECENT_KEY = 'cocanvas.recent'

function loadRecent(): RecentDoc[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as RecentDoc[]
    return Array.isArray(parsed) ? parsed.slice(0, 10) : []
  } catch {
    return []
  }
}

export default function HomePage() {
  const [docId, setDocId] = useState(() => randomDocId())
  const [recent, setRecent] = useState<RecentDoc[]>(() => loadRecent())

  useEffect(() => {
    document.title = 'CoCanvas — 实时协作文档'
  }, [])

  const open = (id: string) => {
    const trimmed = id.trim()
    if (trimmed === '') return
    window.location.hash = `#/doc/${encodeURIComponent(trimmed)}`
  }

  const clearRecent = () => {
    localStorage.removeItem(RECENT_KEY)
    setRecent([])
  }

  return (
    <main className="home">
      <h1>CoCanvas</h1>
      <p className="tagline">基于 CRDT（Yjs）的多人实时协作文档编辑器</p>

      <div className="open-box">
        <input
          value={docId}
          onChange={(event) => setDocId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') open(docId)
          }}
          placeholder="文档 ID"
          aria-label="文档 ID"
          spellCheck={false}
        />
        <button type="button" onClick={() => open(docId)}>
          新建 / 打开
        </button>
        <button type="button" className="ghost" onClick={() => setDocId(randomDocId())}>
          换一个
        </button>
      </div>
      <p className="hint">
        把同一文档链接在两个浏览器标签页打开，即可实时协同编辑、看到彼此光标。
      </p>

      {recent.length > 0 && (
        <section className="recent">
          <div className="recent-head">
            <h2>最近文档</h2>
            <button type="button" className="ghost" onClick={clearRecent}>
              清空
            </button>
          </div>
          <ul>
            {recent.map((item) => (
              <li key={item.id}>
                <button type="button" className="link" onClick={() => open(item.id)}>
                  <span className="recent-title">{item.title || item.id}</span>
                  <span className="recent-id">{item.id}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
