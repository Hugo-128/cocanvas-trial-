import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// 有意不包 StrictMode：开发模式下双重挂载会 create/destroy 两次 provider，
//  Phase 0 先保证行为可预期，后续需要时再加（见 DEVLOG）。
createRoot(document.getElementById('root')!).render(<App />)
