import { useMemo } from 'react'
import { renderInlineMarkdown } from '../components/md'

/** Shares prose's math tokenizer while keeping summary/label markup inline. */
export default function InlineMarkdown({ text }: { text: string }) {
  const html = useMemo(() => renderInlineMarkdown(text), [text])
  return <span className="nui-inline-md" dangerouslySetInnerHTML={{ __html: html }} />
}
