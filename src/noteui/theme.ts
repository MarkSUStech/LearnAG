import { createContext } from 'react'
// Optional local Gallery override; production keeps the existing document theme.
export const NoteUIThemeContext = createContext<'light' | 'dark' | null>(null)
