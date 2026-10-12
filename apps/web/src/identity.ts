import type { CoCanvasUser } from '@cocanvas/protocol'

const IDENTITY_KEY = 'cocanvas.identity'
// 身份存 sessionStorage：每个标签页独立协作者身份。
// 理由：无账号体系下，双标签页 demo 需要显示两个不同的光标/名字才可读
// （localStorage 会让两个标签页共用同一身份，光标完全相同）。
// 刷新同一标签页身份不变；跨设备/跨浏览器天然不同。

const COLORS = [
  '#e11d48', '#2563eb', '#059669', '#d97706',
  '#7c3aed', '#db2777', '#0d9488', '#65a30d',
]

function randomId(): string {
  const bytes = new Uint8Array(4)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function pickColor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return COLORS[hash % COLORS.length] ?? '#2563eb'
}

/** 协作者身份：同一标签页内稳定（sessionStorage），不同标签页/设备不同 */
export function getIdentity(): CoCanvasUser {
  try {
    const raw = sessionStorage.getItem(IDENTITY_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as CoCanvasUser
      if (typeof parsed.id === 'string' && typeof parsed.name === 'string') {
        return parsed
      }
    }
  } catch {
    // localStorage 不可用或数据损坏，走新建分支
  }
  const id = randomId()
  const identity: CoCanvasUser = {
    id,
    name: `用户-${id.slice(0, 4)}`,
    color: pickColor(id),
  }
  try {
    sessionStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
  } catch {
    // 忽略（隐私模式等场景）
  }
  return identity
}

/** 随机文档 ID（首页“新建文档”用） */
export function randomDocId(): string {
  return `doc-${randomId()}`
}
