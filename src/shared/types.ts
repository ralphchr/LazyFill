export interface Settings {
  name: string
  birthday: string
  age: string
  blankFileType: BlankFileType
  attachFiles: boolean
  text: string
  paragraph: string
  email: string
  number: string
  url: string
  includeOptional: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  name: 'Test User',
  birthday: '2000-01-01',
  age: '26',
  blankFileType: 'random',
  attachFiles: true,
  text: '.',
  paragraph: '.',
  email: 'preview@gmail.com',
  number: '1',
  url: 'https://example.com',
  includeOptional: true,
}

export type BlankFileType = 'random' | 'png' | 'pdf' | 'txt'
export type FieldKind = 'text' | 'paragraph' | 'email' | 'number' | 'url' | 'date' | 'file' | 'choice' | 'checkbox' | 'dropdown' | 'manual'

export interface AutomationStatus {
  status: 'idle' | 'running' | 'paused' | 'complete'
  pages: number
  message: string
}

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
  automation?: AutomationStatus
}

export type Request =
  | { type: 'SCAN'; settings: Settings }
  | { type: 'FILL'; settings: Settings; values: { id: string; value: string }[] }
  | { type: 'CLEAR' }
  | { type: 'START'; settings: Settings }
  | { type: 'STOP' }

export interface Response {
  ok: boolean
  scan?: ScanResult
  message?: string
}

export function normalizeSettings(value: unknown): Settings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
    name: typeof input.name === 'string' ? input.name.slice(0, 200) : DEFAULT_SETTINGS.name,
    birthday: typeof input.birthday === 'string' ? input.birthday.slice(0, 10) : DEFAULT_SETTINGS.birthday,
    age: typeof input.age === 'string' ? input.age.slice(0, 3) : DEFAULT_SETTINGS.age,
    blankFileType: ['random', 'png', 'pdf', 'txt'].includes(String(input.blankFileType)) ? input.blankFileType as BlankFileType : DEFAULT_SETTINGS.blankFileType,
    attachFiles: input.attachFiles === undefined ? DEFAULT_SETTINGS.attachFiles : input.attachFiles === true,
    text: typeof input.text === 'string' ? input.text.slice(0, 1000) : DEFAULT_SETTINGS.text,
    paragraph: typeof input.paragraph === 'string' ? input.paragraph.slice(0, 10000) : DEFAULT_SETTINGS.paragraph,
    email: typeof input.email === 'string' ? input.email.slice(0, 1000) : DEFAULT_SETTINGS.email,
    number: typeof input.number === 'string' ? input.number.slice(0, 1000) : DEFAULT_SETTINGS.number,
    url: typeof input.url === 'string' ? input.url.slice(0, 1000) : DEFAULT_SETTINGS.url,
    includeOptional: input.includeOptional === undefined ? DEFAULT_SETTINGS.includeOptional : input.includeOptional === true,
  }
}
