import { placeholder, profileKey } from './profile.ts'
import type { FieldKind, Settings } from './types.ts'

export interface InputHints {
  type?: string
  inputMode?: string
  pattern?: string
  description?: string
  minLength?: number
  maxLength?: number
  numeric?: boolean
  metadataPattern?: string
}
interface CharacterRule {
  format: 'numeric' | 'alphanumeric'
  min: number
  max?: number
  lower?: boolean
  upper?: boolean
}

// Recognize simple character classes without executing a page-supplied regex.
export function patternRule(pattern: string): CharacterRule | null {
  const value = pattern.replace(/^\^/, '').replace(/\$$/, '')
  const match = /^(\\d|\[[^\]]+\])(\+|\*|\?|\{\d+(?:,\d*)?\})?$/.exec(value)
  if (!match) return null
  const alphabet = match[1] === '\\d' ? '\\d' : match[1].slice(1, -1)
  const digits = /0-9|\\d/.test(alphabet)
  const lower = alphabet.includes('a-z')
  const upper = alphabet.includes('A-Z')
  if (!digits || alphabet.replace(/0-9|\\d|a-z|A-Z/g, '')) return null
  const quantifier = match[2] || ''
  let min = quantifier === '*' || quantifier === '?' ? 0 : 1
  let max = quantifier === '' || quantifier === '?' ? 1 : undefined
  if (quantifier.startsWith('{')) {
    const [start, end] = quantifier.slice(1, -1).split(',')
    min = Number(start)
    max = end === undefined ? min : end ? Number(end) : undefined
  }
  if (min > 1000 || (max !== undefined && (max < min || max > 10000))) return null
  return { format: lower || upper ? 'alphanumeric' : 'numeric', min, max, lower, upper }
}

export function characterRule(hints: InputHints): CharacterRule | null {
  const pattern = hints.pattern ? patternRule(hints.pattern) : hints.metadataPattern ? patternRule(hints.metadataPattern) : null
  if (pattern) return pattern
  if (hints.type === 'number' || hints.numeric) return { format: 'numeric', min: 1 }
  const description = hints.description || ''
  if (/\balpha[ -]?numeric\b|\b(?:letters?\s+and\s+(?:numbers?|digits?)|(?:numbers?|digits?)\s+and\s+letters?)\b/i.test(description)) return { format: 'alphanumeric', min: 2, lower: true, upper: true }
  if (/\b(?:(?:numbers?|digits?)\s+only|only\s+(?:numbers?|digits?)|numeric(?:\s+(?:characters?|values?))?(?:\s+only)?|whole\s+number)\b/i.test(description) || /^(numeric|decimal)$/.test(hints.inputMode || '')) return { format: 'numeric', min: 1 }
  return null
}

export function validatedPlaceholder(title: string, kind: FieldKind, settings: Settings, hints: InputHints): string {
  const original = placeholder(title, kind, settings)
  if (kind === 'date' || kind === 'email') return original
  const rule = characterRule(hints)
  if (!rule) return original
  const key = profileKey(title) || (kind === 'phone' ? 'contact' : null)
  const min = Math.min(1000, Math.max(1, rule.min, hints.minLength || 0))
  const max = Math.min(rule.max ?? 1000, hints.maxLength && hints.maxLength > 0 ? hints.maxLength : 1000)
  if (rule.format === 'numeric') {
    if (key === 'age') return original
    if (key === 'contact') {
      const contact = original.replace(/[+\s().-]/g, '')
      return /^0+$/.test(contact) ? contact.padEnd(min, '0').slice(0, max) : contact
    }
    return '0'.repeat(Math.min(min, max))
  }
  let result = key ? original.replace(/[^a-zA-Z0-9]/g, '') : rule.lower ? 'a0' : 'A0'
  if (rule.upper && !rule.lower) result = result.toUpperCase()
  if (rule.lower && !rule.upper) result = result.toLowerCase()
  if (!result) return '' // A deliberately empty profile must still stop for user input.
  return result.repeat(Math.ceil(min / result.length)).slice(0, Math.max(result.length, min)).slice(0, max)
}
