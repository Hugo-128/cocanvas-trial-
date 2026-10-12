import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { CoCanvasProvider } from '@cocanvas/protocol'

/**
 * 中文输入法 composition 保护（AGENTS.md 6.4 高危坑的修复）。
 *
 * y-prosemirror 1.3.x 没有 composition 保护：拼音中间态会作为普通交易
 * 同步进 CRDT 并广播，远端看到拼音字母闪烁。
 *
 * 本扩展在 compositionstart / compositionupdate 时让 provider 按住出站
 * 内容更新，compositionend 时释放（积压 update 合并为一条原子发出）。
 * compositionend 后 ProseMirror 用微任务刷新最终提交交易，因此立即释放
 * 即可保证「最终提交」与「中间态」不会分成两次可见渲染。
 *
 * 安全阀：composition 事件后 5s 无新事件自动释放，防止 compositionend
 * 丢失（IMR 崩溃、焦点异常切换）导致出站被无限期按住。
 */
const SAFETY_RELEASE_MS = 5000

export interface CompositionHoldOptions {
  provider: CoCanvasProvider | null
}

export const CompositionHold = Extension.create<CompositionHoldOptions>({
  name: 'compositionHold',

  addOptions() {
    return { provider: null }
  },

  addProseMirrorPlugins() {
    let safetyTimer: ReturnType<typeof setTimeout> | null = null

    const hold = () => {
      if (safetyTimer !== null) clearTimeout(safetyTimer)
      safetyTimer = setTimeout(() => {
        safetyTimer = null
        this.options.provider?.setContentHold(false)
      }, SAFETY_RELEASE_MS)
      this.options.provider?.setContentHold(true)
    }

    const release = () => {
      if (safetyTimer !== null) {
        clearTimeout(safetyTimer)
        safetyTimer = null
      }
      this.options.provider?.setContentHold(false)
    }

    return [
      new Plugin({
        props: {
          handleDOMEvents: {
            compositionstart: () => {
              hold()
              return false
            },
            compositionupdate: () => {
              // 暂停后继续输入时重新按住（安全阀可能已释放）
              hold()
              return false
            },
            compositionend: () => {
              // 立即释放：PM 在微任务里刷新最终提交交易，
              // 宏任务释放时最终文本已和应用，会被同一批/紧邻发送
              release()
              return false
            },
          },
        },
        view: () => ({
          destroy: () => {
            if (safetyTimer !== null) clearTimeout(safetyTimer)
          },
        }),
      }),
    ]
  },
})
