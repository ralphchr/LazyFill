import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { characterRule, patternRule, validatedPlaceholder } from '../src/shared/validation.ts'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/types.ts'
import { parseOutline } from '../src/content-script/outline.ts'
import { FormEngine } from '../src/content-script/engine.ts'

test('recognizes simple numeric and alphanumeric classes without evaluating arbitrary regexes', () => {
  for (const pattern of ['[0-9]+', '^\\d+$', '[0-9]{4}', '\\d*']) assert.equal(patternRule(pattern)?.format, 'numeric', pattern)
  for (const pattern of ['[A-Za-z0-9]+', '^[a-zA-Z\\d]{6,12}$', '[A-Z0-9]{2,}']) assert.equal(patternRule(pattern)?.format, 'alphanumeric', pattern)
  for (const pattern of ['[A-Z]+', '[^0-9]+', '(a+)+$', '[0-9]{999999999}', 'broken[']) assert.equal(patternRule(pattern), null, pattern)
  assert.equal(characterRule({ inputMode: 'numeric', pattern: '[A-Za-z0-9]+' })?.format, 'alphanumeric')
})

test('uses zeros for number-only fields including legacy profiles and instruction-only constraints', () => {
  const settings = normalizeSettings({ number: '99' })
  for (const hints of [{ type: 'number' }, { inputMode: 'numeric' }, { numeric: true }, { description: 'Enter numbers only' }, { description: 'Only digits are allowed' }]) assert.equal(validatedPlaceholder('Quantity', 'text', settings, hints), '0')
  assert.equal(validatedPlaceholder('Code', 'text', settings, { pattern: '[0-9]{4}' }), '0000')
  assert.equal(validatedPlaceholder('Reference', 'text', settings, { pattern: '\\d+', minLength: 6 }), '000000')
  assert.equal(validatedPlaceholder('Notes', 'paragraph', settings, {}), '.')
})

test('uses alphanumeric placeholders and respects length and case constraints', () => {
  assert.match(validatedPlaceholder('Reference', 'text', DEFAULT_SETTINGS, { description: 'Alphanumeric only' }), /^[A-Za-z0-9]+$/)
  assert.match(validatedPlaceholder('Reference', 'text', DEFAULT_SETTINGS, { pattern: '[A-Z0-9]{8}' }), /^[A-Z0-9]{8}$/)
  assert.match(validatedPlaceholder('Reference', 'text', DEFAULT_SETTINGS, { pattern: '[a-z0-9]{5,10}' }), /^[a-z0-9]{5,10}$/)
  assert.equal(validatedPlaceholder('Full name', 'text', DEFAULT_SETTINGS, { pattern: '[A-Za-z0-9]+' }), 'TestUser')
})

test('preserves age/contact placeholders and strips phone formatting for numeric requirements', () => {
  const settings = { ...DEFAULT_SETTINGS, contact: '+63 912-345-6789', age: '28' }
  assert.equal(validatedPlaceholder('Mobile number', 'phone', settings, { inputMode: 'numeric' }), '639123456789')
  assert.equal(validatedPlaceholder('Phone number', 'phone', settings, {}), settings.contact)
  assert.equal(validatedPlaceholder('Contact number', 'text', DEFAULT_SETTINGS, { pattern: '[0-9]{11}' }), '00000000000')
  assert.equal(validatedPlaceholder('Age', 'number', settings, { type: 'number' }), '28')
  assert.equal(validatedPlaceholder('Contact number', 'text', { ...settings, contact: '' }, { numeric: true }), '')
})

test('reads numeric and positive full-match rules from embedded question data', () => {
  const data = [null, [null, [
    [1, 'Count', null, 0, [[11, null, 1, null, [[1, 2, ['0'], 'Enter a number']]]]],
    [2, 'Code', null, 0, [[12, null, 1, null, [[4, 301, ['^[A-Za-z0-9]{6}$']]]]]],
    [3, 'Excluded', null, 0, [[13, null, 1, null, [[4, 302, ['[0-9]+']]]]]],
  ]]]
  const questions = parseOutline(data)[0].questions
  assert.deepEqual(questions[0].validation, { numeric: true })
  assert.equal(questions[1].validation?.pattern, '^[A-Za-z0-9]{6}$')
  assert.equal(questions[2].validation, undefined)
})

test('fills DOM hints and embedded numeric rules while retaining answers and range validation', async t => {
  const q = (id: string, title: string, input: string) => `<div role="listitem" data-item-id="${id}"><div role="heading">${title}</div>${input}</div>`
  const url = 'https://docs.google.com/forms/d/e/validation/viewform'
  const dom = new JSDOM(`<form>${
    q('phone', 'Contact number *', '<input type="tel" pattern="[0-9]{11}" required>') +
    q('native', 'Quantity *', '<input type="number" required>') +
    q('pattern', 'Reference *', '<input pattern="[A-Za-z0-9]{4}" required>') +
    q('hidden-rule', 'Student ID *', '<input required>') +
    q('hint', 'Digits *', '<input aria-describedby="instructions" required><p id="instructions">Numbers only</p>') +
    q('answered', 'Existing code *', '<input pattern="[0-9]+" required value="123">') +
    q('range', 'Positive quantity *', '<input type="number" min="1" required>')
  }</form>`, { url })
  t.after(() => dom.window.close())
  for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event']) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name as keyof typeof dom.window] })
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: dom.window.getComputedStyle.bind(dom.window) })
  const script = dom.window.document.createElement('script')
  script.textContent = `var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, [null, [[1, 'Student ID', null, 0, [[11, null, 1, null, [[1, 9]]]]]]]])};`
  dom.window.document.body.append(script)
  const engine = new FormEngine(dom.window.document, url, dom.window.sessionStorage)
  const scan = engine.scan()
  await engine.fill(DEFAULT_SETTINGS, scan.fields.map(field => ({ id: field.id, value: field.value })))
  const value = (id: string) => dom.window.document.querySelector<HTMLInputElement>(`[data-item-id="${id}"] input`)!.value
  assert.equal(value('phone'), '00000000000')
  assert.equal(value('native'), '0')
  assert.match(value('pattern'), /^[A-Za-z0-9]{4}$/)
  assert.equal(value('hidden-rule'), '0')
  assert.equal(value('hint'), '0')
  assert.equal(value('answered'), '123')
  assert.equal(value('range'), '') // Zero is not valid here; leave it for the user.
  assert.equal(engine.scan().temporaryCount, 5)
})
