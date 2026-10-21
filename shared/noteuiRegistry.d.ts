// Types for the runtime-neutral registry. Keys are checked against parser/render/catalog in tests.
export interface ParameterSpec { type: 'enum' | 'string'; values?: readonly string[]; default?: string; required?: boolean; maxLength?: number }
export interface ComponentSpec { label: string; category: string; description: string; data: string; params: Record<string,ParameterSpec>; state: string[]; limits: string; surface: string; input?: 'container' | 'none'; children: string[]; slots: string[] }
export const noteUIRegistry: {
  svg: ComponentSpec
  chart: ComponentSpec
  stats: ComponentSpec
  compare: ComponentSpec
  steps: ComponentSpec
  quiz: ComponentSpec
  graph: ComponentSpec
  concept: ComponentSpec
  flashcards: ComponentSpec
  accordion: ComponentSpec
  tree: ComponentSpec
  derivation: ComponentSpec
  code: ComponentSpec
  checklist: ComponentSpec
  table: ComponentSpec
  tabs: ComponentSpec
  cloze: ComponentSpec
  match: ComponentSpec
  rubric: ComponentSpec
  progress: ComponentSpec
  schedule: ComponentSpec
  sequence: ComponentSpec
  distribution: ComponentSpec
  venn: ComponentSpec
  matrix: ComponentSpec
  numberline: ComponentSpec
  geometry: ComponentSpec
  plot: ComponentSpec
  playback: ComponentSpec
  row: ComponentSpec
  col: ComponentSpec
  box: ComponentSpec
  grid: ComponentSpec
  card: ComponentSpec
  divider: ComponentSpec
  spacer: ComponentSpec
  carousel: ComponentSpec
  popover: ComponentSpec
}
export const layoutNames: string[]
export function parameterChoices(name: keyof typeof noteUIRegistry): Record<string,readonly string[] | null>
export function componentGuide(): string
