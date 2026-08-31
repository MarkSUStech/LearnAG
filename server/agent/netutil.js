// 网络错误诊断与瞬时失败重试：
// Node fetch 的 TypeError("fetch failed") 会把真实原因藏在 e.cause（ECONNRESET 等），
// 本模块负责还原原因、识别可重试的瞬时故障，并提供统一重试入口。

/** 把错误链上的原因拼成可读消息："fetch failed（connect ECONNRESET ...）" */
export function netErrInfo(e) {
  const main = String(e?.message || e)
  const parts = []
  let c = e?.cause
  for (let i = 0; i < 3 && c; i++) {
    const t = String(c.code || c.message || c)
    if (t && !parts.includes(t)) parts.push(t)
    c = c.cause
  }
  const detail = parts.join('; ')
  return detail && detail !== main ? `${main}（${detail}）` : main
}

/** 瞬时网络故障：可安全重试（代理/隧道抖动、DNS 抖动、连接被重置、限流、5xx） */
export function isTransientNetErr(e) {
  if (e?.status === 429 || (Number(e?.status) >= 500 && Number(e?.status) < 600)) return true
  const s = [e?.message, e?.cause?.code, e?.cause?.message, String(e?.cause?.errors ?? '')]
    .filter(Boolean)
    .join(' ')
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|other side closed|terminated|UND_ERR|network timeout|upstream connect/i.test(
    s,
  )
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 带重试的请求执行器。fn 收到当前尝试次数（1 开始）；
 * 非瞬时错误或重试耗尽时抛出（瞬时错误耗尽后带原因信息重抛）。
 */
export async function withRetry(fn, { tries = 3, label = '网络请求', backoff = 600, signal } = {}) {
  let lastErr
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn(attempt)
    } catch (e) {
      lastErr = e
      if (signal?.aborted || e?.name === 'AbortError') throw e
      if (attempt < tries && isTransientNetErr(e)) {
        console.warn(`[net] ${label} 第 ${attempt} 次失败（${netErrInfo(e)}），${backoff * attempt}ms 后重试`)
        await sleep(backoff * attempt)
        continue
      }
      if (isTransientNetErr(e)) throw new Error(`${label}失败：${netErrInfo(e)}`)
      throw e
    }
  }
  throw lastErr
}
