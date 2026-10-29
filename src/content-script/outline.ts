import type { Section } from '../shared/types.ts'

const TYPE_NAMES: Record<number, string> = {
  0: 'Short answer', 1: 'Paragraph', 2: 'Multiple choice', 3: 'Dropdown',
  4: 'Checkboxes', 5: 'Linear scale', 7: 'Grid', 9: 'Date', 10: 'Time', 13: 'File upload',
}

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const asText = (value: unknown): string => typeof value === 'string' ? value : ''

// Read JSON only. Never evaluate JavaScript supplied by the page.
export function extractPublicData(source: string): unknown {
  const match = /\bFB_PUBLIC_LOAD_DATA_\s*=\s*/.exec(source)
  if (!match) return null
  const start = match.index + match[0].length
  if (source[start] !== '[') return null
  let depth = 0
  let quoted = false
  let escaped = false
  for (let i = start; i < source.length; i++) {
    const char = source[i]
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '[') depth++
    else if (char === ']' && --depth === 0) {
      try { return JSON.parse(source.slice(start, i + 1)) as unknown } catch { return null }
    }
  }
  return null
}

export function parseOutline(data: unknown): Section[] {
  const items = asArray(asArray(asArray(data)[1])[1])
  if (!items.length) return []
  const sections: Section[] = [{ title: 'Section 1', description: '', questions: [] }]
  for (const raw of items) {
    const item = asArray(raw)
    const type = item[3]
    if (typeof type !== 'number') continue
    if (type === 8) {
      sections.push({ title: asText(item[1]) || `Section ${sections.length + 1}`, description: asText(item[2]), questions: [] })
      continue
    }
    if ([6, 11, 12].includes(type)) continue
    const entries = asArray(item[4]).map(asArray)
    const options = asArray(entries[0]?.[1]).map(asArray).map(option => asText(option[0])).filter(Boolean)
    sections[sections.length - 1].questions.push({
      title: asText(item[1]) || 'Untitled question',
      description: asText(item[2]),
      type: TYPE_NAMES[type] || 'Other question',
      required: entries.some(entry => entry[2] === 1),
      options: [...new Set(options)],
      rows: type === 7 ? entries.flatMap(entry => asArray(entry[3]).map(asText).filter(Boolean)) : [],
    })
  }
  return sections
}

export function readOutline(doc: Document): Section[] {
  for (const script of doc.scripts) {
    if (!script.textContent?.includes('FB_PUBLIC_LOAD_DATA_')) continue
    const sections = parseOutline(extractPublicData(script.textContent))
    if (sections.length) return sections
  }
  return []
}
