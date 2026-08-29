import { useEffect, useRef } from 'react'
import type { SSEEvent } from './types'

/** 订阅服务端 SSE 事件流 */
export function useSSE(onEvent: (e: SSEEvent) => void) {
  const handler = useRef(onEvent)
  handler.current = onEvent
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onmessage = (msg) => {
      try {
        handler.current(JSON.parse(msg.data))
      } catch {
        /* ignore */
      }
    }
    return () => es.close()
  }, [])
}
