import type { ToastItem } from '../types'

export default function Toasts({ items }: { items: ToastItem[] }) {
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>
          <span className="material-symbols-rounded">{t.error ? 'error' : 'check_circle'}</span>
          {t.text}
        </div>
      ))}
    </div>
  )
}
