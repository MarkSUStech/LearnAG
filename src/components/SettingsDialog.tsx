import { useEffect, useState } from 'react'
import { api } from '../api'
import { FONT_PRESETS, WIDTH_PRESETS, type Appearance } from '../appearance'
import type { Settings } from '../types'

interface Props {
  settings: Settings
  appearance: Appearance
  onAppearanceChange: (a: Appearance) => void
  onClose: () => void
  onSaved: (s: Settings) => void
}

export default function SettingsDialog({ settings, appearance, onAppearanceChange, onClose, onSaved }: Props) {
  const [vaultPath, setVaultPath] = useState(settings.vaultPath)
  const [baseURL, setBaseURL] = useState(settings.apiBaseURL)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(settings.model)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    setSaving(true)
    try {
      const patch: Record<string, string> = { vaultPath, apiBaseURL: baseURL, model }
      if (apiKey.trim()) patch.apiKey = apiKey.trim()
      const s = await api.saveSettings(patch)
      onSaved(s)
      setTestResult(null)
    } catch (e) {
      setTestResult({ ok: false, text: (e as Error).message })
    } finally {
      setSaving(false)
    }
  }

  async function test() {
    setTesting(true)
    setTestResult(null)
    try {
      // 先保存再测试，保证测的是当前填写的配置
      const patch: Record<string, string> = { vaultPath, apiBaseURL: baseURL, model }
      if (apiKey.trim()) patch.apiKey = apiKey.trim()
      await api.saveSettings(patch)
      const r = await api.testConnection()
      setTestResult({ ok: true, text: `连接成功，模型已响应：${r.reply.slice(0, 30)}` })
    } catch (e) {
      setTestResult({ ok: false, text: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          设置
          <button className="icon-btn" onClick={onClose}>
            <span className="material-symbols-rounded">close</span>
          </button>
        </div>
        <div className="modal-body">
          <div className="section-title">编辑器外观</div>
          <div className="appearance-grid">
            <div className="field">
              <label>
                字号 <span className="value-tag">{appearance.fontSize}px</span>
              </label>
              <input
                type="range"
                min={13}
                max={22}
                step={1}
                value={appearance.fontSize}
                onChange={(e) => onAppearanceChange({ ...appearance, fontSize: Number(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>行宽</label>
              <select
                value={appearance.maxWidth}
                onChange={(e) => onAppearanceChange({ ...appearance, maxWidth: Number(e.target.value) })}
              >
                {WIDTH_PRESETS.map((w) => (
                  <option key={w.value} value={w.value}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>字体</label>
              <select
                value={appearance.fontPreset}
                onChange={(e) => onAppearanceChange({ ...appearance, fontPreset: e.target.value as Appearance['fontPreset'] })}
              >
                {FONT_PRESETS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="section-title">AI 服务与知识库</div>
          <div className="field">
            <label>知识库（vault）路径</label>
            <input
              value={vaultPath}
              onChange={(e) => setVaultPath(e.target.value)}
              placeholder="例如 C:\Users\me\Documents\Obsidian Vault"
            />
            <div className="hint">本地任意文件夹，兼容 Obsidian Vault；目录需已存在，切换后立即生效</div>
          </div>
          <div className="field">
            <label>AI 服务（OpenAI 兼容）Base URL</label>
            <input
              value={baseURL}
              onChange={(e) => setBaseURL(e.target.value)}
              placeholder="https://api.deepseek.com"
            />
          </div>
          <div className="field">
            <label>API Key {settings.hasApiKey && <span style={{ color: 'var(--text-3)' }}>（已保存 {settings.apiKeyMasked}，留空则不修改）</span>}</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings.hasApiKey ? '••••••••' : 'sk-…'}
            />
          </div>
          <div className="field">
            <label>模型名称</label>
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="deepseek-chat" />
            <div className="hint">需支持 function calling（DeepSeek / GLM / OpenAI / 兼容接口均可）</div>
          </div>
        </div>
        <div className="modal-foot">
          {testResult && (
            <span className={`test-result ${testResult.ok ? 'ok' : 'fail'}`} title={testResult.text}>
              {testResult.text}
            </span>
          )}
          <button className="btn" onClick={test} disabled={testing || saving}>
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>
              network_check
            </span>
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button className="btn primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
