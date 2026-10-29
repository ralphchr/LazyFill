import type { FieldKind, Settings } from './types.ts'

export type ProfileKey = 'name' | 'birthday' | 'email' | 'age' | 'contact'

export function profileKey(title: string): ProfileKey | null {
  const text = title.toLowerCase().replace(/[_*():?.#]/g, ' ').replace(/\s+/g, ' ').trim()
  if (/\b(birth\s*(day|date)|date of birth|dob)\b/.test(text)) return 'birthday'
  if (/\b(e-?mail|gmail)\b/.test(text)) return 'email'
  if (/\b(?:contact|phone|mobile|cell(?:phone)?|telephone)\s*(?:number|no\b|#)\b|\b(?:phone|telephone|cellphone)\b|^(?:your\s+)?(?:mobile|contact)$/.test(text)) return 'contact'
  if (/^(?:\d+\s+)?(?:your\s+)?age\b/.test(text) || /\bhow old are you\b/.test(text)) return 'age'
  if ((/\b(company|school|business|organization|employer|parent|father|mother|guardian|pet|project|user|college|university|program|event|team|course)\b/.test(text) && /\bname\b/.test(text)) || /\busername\b/.test(text)) return null
  if (/^(?:\d+\s+)?(?:your\s+)?(?:(?:full|first|middle|last|given|family|complete|legal)\s+)?name$/.test(text) || /^name\s+(?:last|first)\b/.test(text) || /\b(full|complete|legal) name\b/.test(text) || /\bname of (?:the )?(?:applicant|respondent|student)\b/.test(text)) return 'name'
  return null
}

export function placeholder(title: string, kind: FieldKind, settings: Settings): string {
  const key = profileKey(title)
  if (key === 'name') {
    const parts = settings.name.trim().split(/\s+/)
    if (/\bfirst\b.*\blast\b|\blast\b.*\bfirst\b/i.test(title)) return settings.name
    if (/\b(first|given)\s+name\b/i.test(title)) return parts[0] || ''
    if (/\b(last|family)\s+name\b/i.test(title)) return parts.length > 1 ? parts.at(-1)! : settings.name
    if (/\bmiddle\s+name\b/i.test(title)) return parts.length > 2 ? parts.slice(1, -1).join(' ') : '.'
    return settings.name
  }
  if (key === 'birthday' && kind !== 'date' && dateParts(settings.birthday)) {
    const [year, month, day] = settings.birthday.split('-')
    if (/mm\s*\/\s*dd\s*\/\s*yyyy/i.test(title)) return `${month}/${day}/${year}`
    if (/dd\s*\/\s*mm\s*\/\s*yyyy/i.test(title)) return `${day}/${month}/${year}`
  }
  if (key) return settings[key]
  if (kind === 'date') return settings.birthday
  if (kind === 'text' || kind === 'paragraph') return '.'
  if (kind === 'number') return '0'
  if (kind === 'phone') return settings.contact
  if (kind === 'email') return settings.email
  if (kind === 'url') return settings.url
  return ''
}

export function dateParts(value: string): { year: string; month: string; day: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null
  const [year, month, day] = value.split('-')
  return { year, month: String(Number(month)), day: String(Number(day)) }
}
