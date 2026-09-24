import { useEffect, useState } from 'react'
import { api } from '../api'
import { FONT_PRESETS, WIDTH_PRESETS, type Appearance } from '../appearance'
import type { RagStatus, Settings } from '../types'

interface Props {
  settings: Settings
  appearance: Appearance
  onAppearanceChange: (a: Appearance) => void
  onClose: () => void
  onSaved: (s: Settings) => void
}

const RAG_MODELS = [
  { value: 'jina-v2-base-zh', label: 'Jina v2 base zh（中英双语 · 推荐 ~160MB）' },
  { value: 'bge-m3', label: 'BGE-M3（最强多语 · 较慢 ~600MB）' },
  { value: 'm-e5-small', label: 'Multilingual E5 small（轻量 ~120MB）' },
]

export default function SettingsDialog({ settings, appearance, onAppearanceChange, onClose, onSaved }: Props) {
  const [vaultPath, setVaultPath] = useState(settings.vaultPath)
  const [engine, setEngine] = useState<'api' | 'zcode'>(settings.engine === 'zcode' ? 'zcode' : 'api')
  const [tutorEngine, setTutorEngine] = useState<'follow' | 'api' | 'zcode'>((settings.tutorEngine as any) || 'follow')
  const [zcodePath, setZcodePath] = useState(settings.zcodePath || '')
  const [zcodeInfo, setZcodeInfo] = useState<{ found: boolean; version: string; path: string } | null>(null)
  const [baseURL, setBaseURL] = useState(settings.apiBaseURL)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(settings.model)
  const [ragModel, setRagModel] = useState(settings.ragModel || 'jina-v2-base-zh')
  const [ragStatus, setRagStatus] = useState<RagStatus | null>(null)
  const [reindexing, setReindexing] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  // ZCode CLI 探测（对话框打开期间 + 路径变化时）
  useEffect(() => {
    if (engine !== 'zcode') return
    let alive = true
    const tick = () =>
      api
        .zcodeStatus()
        .then((s) => alive && setZcodeInfo(s))
        .catch(() => undefined)
    tick()
    const timer = setInterval(tick, 4000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [engine, zcodePath])

  // RAG 状态轮询（对话框打开期间）
  useEffect(() => {
    let alive = true
    const tick = () =>
      api
        .ragStatus()
        .then((s) => alive && setRagStatus(s))
        .catch(() => undefined)
    tick()
    const timer = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

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
      const patch: Record<string, string | number> = { vaultPath, apiBaseURL: baseURL, model, ragModel, engine, tutorEngine, zcodePath: zcodePath.trim() }
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
      const patch: Record<string, string | number> = { vaultPath, apiBaseURL: baseURL, model, engine, tutorEngine, zcodePath: zcodePath.trim() }
      if (apiKey.trim()) patch.apiKey = apiKey.trim()
      await api.saveSettings(patch)
      const r = await api.testConnection()
      setTestResult({ ok: true, text: `连接成功：${r.reply.slice(0, 40)}` })
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
          <div className="section-title">AI 引擎与知识库</div>
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
            <label>AI 引擎</label>
            <select value={engine} onChange={(e) => setEngine(e.target.value as 'api' | 'zcode')}>
              <option value="api">API 服务（OpenAI 兼容）</option>
              <option value="zcode">ZCode（本机智能体，走你的账号额度）</option>
            </select>
            <div className="hint">
              {engine === 'zcode'
                ? '学习任务交给本机 ZCode 智能体：直接读写知识库、联网查证、写笔记，也能通过提问卡片向你出题；凭据复用桌面版 ZCode 登录，无需 API Key。答疑/翻译/图表修复同步切换'
                : '所有 AI 功能走下方配置的 OpenAI 兼容服务'}
            </div>
          </div>
          {engine === 'zcode' && (
            <>
              <div className="field">
                <label>ZCode CLI 状态</label>
                <div className="rag-status">
                  <span className={`rag-dot ${zcodeInfo?.found ? 'ready' : 'error'}`} />
                  <span>
                    {zcodeInfo == null
                      ? '探测中…'
                      : zcodeInfo.found
                        ? `已找到${zcodeInfo.version ? ' · v' + zcodeInfo.version : ''}`
                        : '未找到，请检查路径或安装桌面版 ZCode'}
                  </span>
                </div>
                <div className="hint" style={{ wordBreak: 'break-all' }}>
                  {zcodeInfo?.path || ''}
                </div>
              </div>
              <div className="field">
                <label>ZCode CLI 路径（留空自动探测桌面版内置内核）</label>
                <input value={zcodePath} onChange={(e) => setZcodePath(e.target.value)} placeholder={settings.zcodeAutoPath} />
              </div>
            </>
          )}
          <div className="field">
            <label>答疑助手引擎（笔记侧边小窗）</label>
            <select value={tutorEngine} onChange={(e) => setTutorEngine(e.target.value as 'follow' | 'api' | 'zcode')}>
              <option value="follow">跟随主引擎</option>
              <option value="api">API 服务（快，推荐）</option>
              <option value="zcode">ZCode（本机智能体）</option>
            </select>
            <div className="hint">答疑需要快速响应：主引擎选 ZCode 时建议答疑保持 API</div>
          </div>
          <div className="field">
            <label>API 服务{engine === 'zcode' ? '（后备引擎）Base URL' : '（OpenAI 兼容）Base URL'}</label>
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
          <div className="section-title">本地 RAG 知识库检索</div>
          <div className="field">
            <label>Embedding 模型（中英双语，本地 ONNX 运行）</label>
            <select value={ragModel} onChange={(e) => setRagModel(e.target.value)}>
              {RAG_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <div className="hint">首次使用自动下载模型；切换模型后全库自动重索引。检索覆盖笔记、PDF 原文与学习器标注/卡片</div>
          </div>
          {ragStatus && (
            <div className="rag-status">
              <span className={`rag-dot ${ragStatus.status}`} />
              <span>
                {ragStatus.status === 'error'
                  ? ragStatus.error
                  : ragStatus.status === 'loading'
                    ? `模型加载中…（${ragStatus.downloadProgress}%）`
                    : `已索引 ${ragStatus.chunks} 个片段（${ragStatus.files}/${ragStatus.vaultFiles} 个文件）`}
                {ragStatus.queue > 0 ? ` · 队列中 ${ragStatus.queue}` : ''}
              </span>
              <button
                className="btn"
                disabled={reindexing}
                onClick={async () => {
                  setReindexing(true)
                  try {
                    await api.reindexRag()
                  } finally {
                    setReindexing(false)
                  }
                }}
              >
                {reindexing ? '重建中…' : '重建索引'}
              </button>
            </div>
          )}
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
