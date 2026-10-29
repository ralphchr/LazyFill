export interface Settings {
  text: string
  paragraph: string
  email: string
  number: string
  url: string
  includeOptional: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  text: 'TEMPORARY — replace before submitting',
  paragraph: 'Temporary answer for reviewing this form. Replace before submitting.',
  email: 'preview@example.com',
  number: '1',
  url: 'https://example.com',
  includeOptional: false,
}

export type FieldKind = 'text' | 'paragraph' | 'email' | 'number' | 'url' | 'choice' | 'checkbox' | 'dropdown' | 'manual'

export interface FieldPreview {
  id: string
  title: string
  kind: FieldKind
  required: boolean
  value: string
  options?: string[]
  status: 'ready' | 'answered' | 'optional' | 'manual'
  note?: string
}

export interface OutlineQuestion {
  title: string
  description: string
  type: string
  required: boolean
  options: string[]
  rows: string[]
}

export interface Section {
  title: string
  description: string
  questions: OutlineQuestion[]
}

export interface ScanResult {
  isGoogleForm: boolean
  title: string
  fields: FieldPreview[]
  sections: Section[]
  temporaryCount: number
  outlineAvailable: boolean
}

export type Request =
  | { type: 'SCAN'; settings: Settings }
  | { type: 'FILL'; settings: Settings; values: { id: string; value: string }[] }
  | { type: 'CLEAR' }

export interface Response {
  ok: boolean
  scan?: ScanResult
  message?: string
}

export function normalizeSettings(value: unknown): Settings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    text: typeof input.text === 'string' ? input.text.slice(0, 1000) : DEFAULT_SETTINGS.text,
    paragraph: typeof input.paragraph === 'string' ? input.paragraph.slice(0, 10000) : DEFAULT_SETTINGS.paragraph,
    email: typeof input.email === 'string' ? input.email.slice(0, 1000) : DEFAULT_SETTINGS.email,
    number: typeof input.number === 'string' ? input.number.slice(0, 1000) : DEFAULT_SETTINGS.number,
    url: typeof input.url === 'string' ? input.url.slice(0, 1000) : DEFAULT_SETTINGS.url,
    includeOptional: input.includeOptional === true,
  }
}
