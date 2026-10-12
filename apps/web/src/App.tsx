import { useEffect, useState } from 'react'
import HomePage from './pages/HomePage'
import EditorPage from './pages/EditorPage'

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash || '#/')
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

export default function App() {
  const hash = useHashRoute()
  const docId = /^#\/doc\/(.+)$/.exec(hash)?.[1]
  if (docId !== undefined) {
    return <EditorPage docId={decodeURIComponent(docId)} />
  }
  return <HomePage />
}
