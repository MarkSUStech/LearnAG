import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// monaco-editor 0.53+ 的 exports 映射与 Vite 的 ?worker 查询互不兼容
// （带查询的裸导入解析出 esm/vs/esm/vs/... 不存在的路径），这里对 worker 入口做显式别名。
const monacoEsm = fileURLToPath(new URL('./node_modules/monaco-editor/esm/vs', import.meta.url))
const monacoWorkerAlias = [
  { find: /^monaco-editor\/editor\.worker/, replacement: path.join(monacoEsm, 'editor/editor.worker') },
  { find: /^monaco-editor\/language\/json\/json\.worker/, replacement: path.join(monacoEsm, 'language/json/json.worker') },
  { find: /^monaco-editor\/language\/css\/css\.worker/, replacement: path.join(monacoEsm, 'language/css/css.worker') },
  { find: /^monaco-editor\/language\/html\/html\.worker/, replacement: path.join(monacoEsm, 'language/html/html.worker') },
  { find: /^monaco-editor\/language\/typescript\/ts\.worker/, replacement: path.join(monacoEsm, 'language/typescript/ts.worker') },
]

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: monacoWorkerAlias,
  },
  optimizeDeps: {
    // monaco 的 ?worker 导入会被优化器注册成坏条目（optimized info should be defined），
    // 排除后 dev 下直接走源码 ESM（构建不受影响）
    exclude: ['monaco-editor'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        ws: true, // IDE 语言服务器走 /api/lsp WebSocket
      },
    },
  },
  worker: {
    // pdf.js worker 以 ESM 引入，必须用 es 格式打包
    format: 'es',
  },
  build: {
    chunkSizeWarningLimit: 4000,
  },
})
