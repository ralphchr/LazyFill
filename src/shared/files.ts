import type { Settings, TemporaryFile } from './types.ts'

export function randomChoice<T>(options: readonly T[], random = Math.random): T | undefined {
  return options[Math.min(options.length - 1, Math.max(0, Math.floor(random() * options.length)))]
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  txt: 'text/plain', csv: 'text/csv', zip: 'application/zip', mp4: 'video/mp4', mp3: 'audio/mpeg',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export function acceptsFile(file: Pick<TemporaryFile, 'name' | 'type'>, accept = ''): boolean {
  const formats = accept.split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  if (!formats.length) return true
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase() || MIME[name.split('.').at(-1) || ''] || ''
  return formats.some(format => format === '*/*' || (format.startsWith('.') ? name.endsWith(format) : format.endsWith('/*') ? type.startsWith(format.slice(0, -1)) : type === format))
}

export function filesForQuestion(settings: Settings, fieldId: string): TemporaryFile[] {
  const chosen = settings.uploadAssignments[fieldId]
  return chosen ? settings.uploadFiles.filter(file => file.id === chosen) : settings.uploadFiles
}

export function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`
}
