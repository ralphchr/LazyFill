import test from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { JSDOM } from 'jsdom'
import { blankPdf, blankPng, makeBlankFile, randomChoice } from '../src/shared/files.ts'
import { FormEngine } from '../src/content-script/engine.ts'
import { DEFAULT_SETTINGS } from '../src/shared/types.ts'

test('random choices can select every available option and handle an empty list', () => {
  assert.equal(randomChoice(['A', 'B', 'C'], () => 0), 'A')
  assert.equal(randomChoice(['A', 'B', 'C'], () => 0.5), 'B')
  assert.equal(randomChoice(['A', 'B', 'C'], () => 0.99), 'C')
  assert.equal(randomChoice([], () => 0.5), undefined)
})

test('blank PNG contains valid chunks and one fully transparent pixel', () => {
  const png = Buffer.from(blankPng())
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
  const types: string[] = []
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    types.push(type)
    const body = png.subarray(offset + 4, offset + 8 + size)
    let crc = 0xffffffff
    for (const byte of body) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    assert.equal(png.readUInt32BE(offset + 8 + size), (crc ^ 0xffffffff) >>> 0)
    if (type === 'IHDR') {
      assert.equal(png.readUInt32BE(offset + 8), 1)
      assert.equal(png.readUInt32BE(offset + 12), 1)
      assert.equal(png[offset + 17], 6) // RGBA
    }
    if (type === 'IDAT') assert.deepEqual([...inflateSync(png.subarray(offset + 8, offset + 8 + size))], [0, 0, 0, 0, 0])
    offset += size + 12
  }
  assert.deepEqual(types, ['IHDR', 'IDAT', 'IEND'])
})

test('blank PDF has one page, an empty content stream, and correct cross-reference offsets', () => {
  const pdf = new TextDecoder().decode(blankPdf())
  assert.ok(pdf.startsWith('%PDF-1.4'))
  assert.match(pdf, /\/Count 1/)
  assert.match(pdf, /\/Length 0 >>\nstream\n\nendstream/)
  const start = Number(pdf.match(/startxref\n(\d+)/)![1])
  assert.equal(pdf.slice(start, start + 4), 'xref')
  const entries = [...pdf.matchAll(/^(\d{10}) 00000 n /gm)]
  assert.equal(entries.length, 4)
  entries.forEach((entry, index) => assert.ok(pdf.slice(Number(entry[1])).startsWith(`${index + 1} 0 obj`)))
})

test('blank files obey accepted formats and text files have zero bytes', async () => {
  assert.equal(makeBlankFile('random', '.pdf', () => 0)!.type, 'application/pdf')
  assert.equal(makeBlankFile('random', 'image/*', () => 0.99)!.type, 'image/png')
  assert.equal(makeBlankFile('random', '.docx'), null)
  assert.equal(makeBlankFile('png', '.pdf'), null)
  const file = makeBlankFile('txt')!
  assert.match(file.name, /^formpass-blank-[a-f0-9]+\.txt$/)
  assert.equal(file.size, 0)
  assert.equal(await file.text(), '')
  assert.ok(makeBlankFile('pdf')!.size > 0)
  assert.ok(makeBlankFile('png')!.size > 0)
})

test('attaches an accepted blank file through file-input events and preserves existing files', async t => {
  const url = 'https://docs.google.com/forms/d/e/files/viewform'
  const dom = new JSDOM('<form><div role="listitem" data-item-id="new"><div role="heading">New upload *</div><input type="file" accept=".pdf" required></div><div role="listitem" data-item-id="existing"><div role="heading">Existing upload *</div><input type="file" required></div></form>', { url })
  t.after(() => dom.window.close())
  for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name as keyof typeof dom.window] })
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) })
  const original = Object.getOwnPropertyDescriptor(globalThis, 'DataTransfer')
  // jsdom has no OS file picker; provide the browser's transfer contract.
  class Transfer {
    files: File[] = []
    items = { add: (file: File) => this.files.push(file) }
  }
  Object.defineProperty(globalThis, 'DataTransfer', { configurable: true, value: Transfer })
  t.after(() => { if (original) Object.defineProperty(globalThis, 'DataTransfer', original); else Reflect.deleteProperty(globalThis, 'DataTransfer') })
  const inputs = [...dom.window.document.querySelectorAll('input')]
  const attached: File[][] = [[], [new File(['real document'], 'final.pdf', { type: 'application/pdf' })]]
  inputs.forEach((input, index) => Object.defineProperty(input, 'files', { configurable: true, get: () => attached[index], set: value => { attached[index] = [...value] } }))
  let changed = 0
  inputs[0].addEventListener('change', () => changed++)
  const engine = new FormEngine(dom.window.document, url, dom.window.sessionStorage)
  const scan = engine.scan()
  assert.deepEqual(scan.fields.map(field => field.status), ['ready', 'answered'])
  await engine.fill(DEFAULT_SETTINGS, scan.fields.map(field => ({ id: field.id, value: field.value })))
  assert.equal(attached[0].length, 1)
  assert.equal(attached[0][0].type, 'application/pdf')
  assert.equal(attached[1][0].name, 'final.pdf')
  assert.equal(changed, 1)
  assert.equal(engine.scan().temporaryCount, 1)
  assert.equal(engine.scan({ ...DEFAULT_SETTINGS, attachFiles: false }).fields[0].status, 'answered')
})
