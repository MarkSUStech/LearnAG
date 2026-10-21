import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import 'material-symbols'
import './styles/index.css'
import './mathTagPatch'

const WorkspacePreview = React.lazy(() => import('./design-preview/LearningWorkspace'))
const isDesignPreview = new URLSearchParams(window.location.search).get('design') === 'workspace'
const NoteUIGallery = React.lazy(() => import('./noteui/Gallery'))
const isGallery = new URLSearchParams(window.location.search).get('gallery') === 'noteui'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isGallery ? <React.Suspense fallback={<div style={{ padding: 32 }}>正在打开 NoteUI Gallery…</div>}><NoteUIGallery /></React.Suspense> : isDesignPreview ? <React.Suspense fallback={<div style={{ padding: 32 }}>正在打开学习工作台初稿…</div>}><WorkspacePreview /></React.Suspense> : <App />}
  </React.StrictMode>,
)
