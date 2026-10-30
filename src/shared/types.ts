export interface Settings {
  name: string
  birthday: string
  age: string
  contact: string
  uploadFiles: TemporaryFile[]
  uploadAssignments: Record<string, string>
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
  contact: '0',
  uploadFiles: [],
  uploadAssignments: {},
  text: '.',
  paragraph: '.',
  email: 'preview@gmail.com',
  number: '0',
  url: 'https://example.com',
  includeOptional: true,
}

export interface TemporaryFile {
  id: string
  name: string
  type: string
  size: number
  lastModified: number
}
export type FieldKind = 'text' | 'paragraph' | 'email' | 'phone' | 'number' | 'url' | 'date' | 'file' | 'choice' | 'checkbox' | 'dropdown' | 'manual'

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
  validation?: { numeric?: boolean; pattern?: string }
  entryIds?: string[]
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
    contact: typeof input.contact === 'string' ? input.contact.slice(0, 50) : DEFAULT_SETTINGS.contact,
    uploadFiles: Array.isArray(input.uploadFiles) ? input.uploadFiles.filter((file): file is TemporaryFile => !!file && typeof file === 'object' && typeof file.id === 'string' && typeof file.name === 'string' && typeof file.type === 'string' && Number.isSafeInteger(file.size) && file.size >= 0 && typeof file.lastModified === 'number').map(file => ({ id: file.id, name: file.name, type: file.type, size: file.size, lastModified: file.lastModified })) : [],
    uploadAssignments: input.uploadAssignments && typeof input.uploadAssignments === 'object' && !Array.isArray(input.uploadAssignments) ? Object.fromEntries(Object.entries(input.uploadAssignments).filter(([, id]) => typeof id === 'string')) : {},
    text: typeof input.text === 'string' ? input.text.slice(0, 1000) : DEFAULT_SETTINGS.text,
    paragraph: typeof input.paragraph === 'string' ? input.paragraph.slice(0, 10000) : DEFAULT_SETTINGS.paragraph,
    email: typeof input.email === 'string' ? input.email.slice(0, 1000) : DEFAULT_SETTINGS.email,
    number: '0',
    url: typeof input.url === 'string' ? input.url.slice(0, 1000) : DEFAULT_SETTINGS.url,
    includeOptional: input.includeOptional === undefined ? DEFAULT_SETTINGS.includeOptional : input.includeOptional === true,
  }
}
