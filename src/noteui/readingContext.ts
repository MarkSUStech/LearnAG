import { createContext } from 'react'
import type { CiteInfo } from '../cite'
export const NoteUIReadingContext = createContext<{ onWikilink?: (target: string) => void; onOpenCite?: (info: CiteInfo) => void }>({})
