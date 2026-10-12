import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import { CoCanvasProvider, type CoCanvasUser } from '@cocanvas/protocol'
import { CompositionHold } from './compositionHold'

export interface CollabEditorProps {
  provider: CoCanvasProvider
  user: CoCanvasUser
}

export function CollabEditor({ provider, user }: CollabEditorProps) {
  const editor = useEditor({
    extensions: [
      // history 必须关：协作场景的撤销/重交由 y-prosemirror 的
      // UndoManager（Collaboration 扩展内置）负责，两套历史会互相打架
      StarterKit.configure({ history: false }),
      Collaboration.configure({ document: provider.doc }),
      // 注意：这个选项要传 provider 对象（扩展内部访问 provider.awareness），
      // 不是直接传 Awareness 实例
      CollaborationCursor.configure({ provider, user }),
      // 中文输入法 composition 保护（见 compositionHold.ts 注释）
      CompositionHold.configure({ provider }),
    ],
  })

  // data-doc-text 是给 E2E 测试的精确文本缝隙：
  // ProseMirror 的 innerText 会混入协作光标标签等装饰节点文本，
  // editor.getText() 只返回文档正文，断言不受污染
  const docText = editor?.getText() ?? ''

  return (
    <div className="editor-wrap" data-doc-text={docText}>
      <EditorContent editor={editor} />
    </div>
  )
}
