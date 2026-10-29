import type { BlankFileType } from './types.ts'

type Format = Exclude<BlankFileType, 'random'>
const MIME: Record<Format, string> = { png: 'image/png', pdf: 'application/pdf', txt: 'text/plain' }

export function randomChoice<T>(options: readonly T[], random = Math.random): T | undefined {
  return options[Math.min(options.length - 1, Math.max(0, Math.floor(random() * options.length)))]
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return result
}

function uint(value: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}

const encode = (text: string) => new TextEncoder().encode(text)
function chunk(type: string, data: Uint8Array) {
  const body = concat(encode(type), data)
  let crc = 0xffffffff
  for (const byte of body) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  return concat(uint(data.length), body, uint((crc ^ 0xffffffff) >>> 0))
}

export function blankPng(): Uint8Array<ArrayBuffer> {
  // A valid, transparent 1×1 RGBA PNG. The zlib block stores one empty scanline.
  const header = concat(uint(1), uint(1), new Uint8Array([8, 6, 0, 0, 0]))
  const data = new Uint8Array([0x78, 0x01, 0x01, 5, 0, 0xfa, 0xff, 0, 0, 0, 0, 0, 0, 5, 0, 1])
  return concat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', data), chunk('IEND', new Uint8Array()))
}

export function blankPdf(): Uint8Array<ArrayBuffer> {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
  ]
  let document = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(document.length)
    document += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = document.length
  document += `xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return encode(document)
}

export function makeBlankFile(kind: BlankFileType = 'random', accept = '', random = Math.random): File | null {
  const filters = accept.toLowerCase().split(',').map(value => value.trim()).filter(Boolean)
  const supported: Format[] = kind === 'random' ? ['png', 'pdf', 'txt'] : [kind]
  const allowed = supported.filter(format => !filters.length || filters.some(filter => filter === '*/*' || filter === `.${format}` || filter === MIME[format] || (filter.endsWith('/*') && MIME[format].startsWith(filter.slice(0, -1)))))
  const format = randomChoice(allowed, random)
  if (!format) return null
  const data = format === 'png' ? blankPng() : format === 'pdf' ? blankPdf() : new Uint8Array()
  const suffix = Math.floor(random() * 0xffffff).toString(16).padStart(6, '0')
  return new File([data], `formpass-blank-${suffix}.${format}`, { type: MIME[format] })
}
