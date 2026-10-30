import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { acceptsFile, filesForQuestion, randomChoice } from '../src/shared/files.ts'
import { FormEngine } from '../src/content-script/engine.ts'
import { DEFAULT_SETTINGS } from '../src/shared/types.ts'

test('random choices can select every available option and handle an empty list', () => {
  assert.equal(randomChoice(['A', 'B', 'C'], () => 0), 'A')
  assert.equal(randomChoice(['A', 'B', 'C'], () => .5), 'B')
  assert.equal(randomChoice(['A', 'B', 'C'], () => .99), 'C')
  assert.equal(randomChoice([], () => .5), undefined)
})

test('matches file extensions, MIME types and wildcards including browser files with no MIME', () => {
  const file = { name: 'My.Document.PDF', type: '' }
  assert.equal(acceptsFile(file, '.pdf'), true)
  assert.equal(acceptsFile(file, 'application/pdf'), true)
  assert.equal(acceptsFile(file, '.png, image/*'), false)
  assert.equal(acceptsFile({ name: 'photo.JPG', type: 'image/jpeg' }, 'image/*'), true)
  assert.equal(acceptsFile(file), true)
})

test('an explicit assignment never falls back to another file when missing or incompatible', () => {
  const file = { id: 'file-1', name: 'file.pdf', type: 'application/pdf', size: 2, lastModified: 0 }
  assert.deepEqual(filesForQuestion({ ...DEFAULT_SETTINGS, uploadFiles: [file] }, 'question'), [file])
  assert.deepEqual(filesForQuestion({ ...DEFAULT_SETTINGS, uploadFiles: [file], uploadAssignments: { question: 'removed' } }, 'question'), [])
})

test('attaches the exact selected file through input events and preserves existing uploads', async t => {
  const url = 'https://docs.google.com/forms/d/e/files/viewform'
  const dom = new JSDOM('<form><div role="listitem" data-item-id="new"><div role="heading">New upload *</div><input type="file" accept=".pdf" required></div><div role="listitem" data-item-id="existing"><div role="heading">Existing upload *</div><input type="file" required></div></form>', { url })
  t.after(() => dom.window.close())
  for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name as keyof typeof dom.window] })
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) })
  const original = Object.getOwnPropertyDescriptor(globalThis, 'DataTransfer')
  class Transfer { files: File[] = []; items = { add: (file: File) => this.files.push(file) } }
  Object.defineProperty(globalThis, 'DataTransfer', { configurable: true, value: Transfer })
  t.after(() => { if (original) Object.defineProperty(globalThis, 'DataTransfer', original); else Reflect.deleteProperty(globalThis, 'DataTransfer') })
  const inputs = [...dom.window.document.querySelectorAll('input')]
  const file = new File(['original bytes unchanged'], 'my-chosen-document.pdf', { type: 'application/pdf' })
  const attached: File[][] = [[], [new File(['real document'], 'final.pdf', { type: 'application/pdf' })]]
  inputs.forEach((input, index) => Object.defineProperty(input, 'files', { configurable: true, get: () => attached[index], set: value => { attached[index] = [...value] } }))
  let changed = 0
  inputs[0].addEventListener('change', () => changed++)
  const engine = new FormEngine(dom.window.document, url, dom.window.sessionStorage, async () => file)
  assert.equal(engine.scan().fields[0].status, 'manual')
  const metadata = { id: 'chosen', name: file.name, type: file.type, size: file.size, lastModified: file.lastModified }
  const settings = { ...DEFAULT_SETTINGS, uploadFiles: [metadata] }
  const scan = engine.scan(settings)
  assert.deepEqual(scan.fields.map(field => field.status), ['ready', 'answered'])
  await engine.fill(settings, scan.fields.map(field => ({ id: field.id, value: field.value })))
  assert.equal(attached[0][0].name, file.name)
  assert.equal(await attached[0][0].text(), 'original bytes unchanged')
  assert.equal(attached[1][0].name, 'final.pdf')
  assert.equal(changed, 1)
  assert.equal(engine.scan().temporaryCount, 1)
})
