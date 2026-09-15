// RAG embedding 模型预设（rag.js 主线程与 rag-worker.js 共用）
export const RAG_MODELS = {
  'jina-v2-base-zh': {
    id: 'Xenova/jina-embeddings-v2-base-zh',
    dim: 768,
    label: 'Jina v2 base zh（中英双语 · 推荐）',
    queryPrefix: 'Query: ',
    size: '~160MB',
  },
  'bge-m3': {
    id: 'Xenova/bge-m3',
    dim: 1024,
    label: 'BGE-M3（最强多语 · 较慢）',
    queryPrefix: '',
    size: '~600MB',
  },
  'm-e5-small': {
    id: 'Xenova/multilingual-e5-small',
    dim: 384,
    label: 'Multilingual E5 small（轻量）',
    queryPrefix: 'query: ',
    size: '~120MB',
  },
}
