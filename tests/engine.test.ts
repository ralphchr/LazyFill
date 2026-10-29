import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { FormEngine, isRespondentForm } from '../src/content-script/engine.ts'
import { DEFAULT_SETTINGS } from '../src/shared/types.ts'

const URL = 'https://docs.google.com/forms/d/e/example/viewform'
const question = (title: string, controls: string, id = title) => `<div role="listitem" data-item-id="${id}"><div role="heading">${title}</div>${controls}</div>`

function setup(body: string) {
  const dom = new JSDOM(`<html><head><title>Test form - Google Forms</title></head><body><form>${body}</form></body></html>`, { url: URL })
  const win = dom.window
  for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event', 'KeyboardEvent']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: win[name as keyof typeof win] })
  }
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: win.getComputedStyle.bind(win) })
  const doc = win.document
  return { doc, win, engine: new FormEngine(doc, URL, win.sessionStorage) }
}

test('detects respondent forms precisely, including signed-in paths and formResponse', () => {
  const { doc } = setup(question('Name', '<input required>'))
  assert.equal(isRespondentForm(doc, URL), true)
  assert.equal(isRespondentForm(doc, 'https://docs.google.com/forms/u/0/d/example/viewform'), true)
  assert.equal(isRespondentForm(doc, 'https://docs.google.com/forms/d/e/example/formResponse'), true)
  for (const href of ['https://docs.google.com.attacker.test/forms/d/e/example/viewform', 'https://docs.google.com/forms/d/example/edit', 'https://example.com/forms/d/e/example/viewform']) assert.equal(isRespondentForm(doc, href), false)
})

test('previews required blanks and preserves existing, hidden and optional answers', async () => {
  const { doc, engine } = setup(
    question('Name *', '<input required name="entry.1">') +
    question('Email *', '<input type="email" required value="real@example.com">') +
    question('Notes', '<textarea></textarea>') +
    '<div hidden>' + question('Invisible', '<input required>') + '</div>',
  )
  const settings = { ...DEFAULT_SETTINGS, includeOptional: false }
  const scan = engine.scan(settings)
  assert.deepEqual(scan.fields.map(field => field.status), ['ready', 'answered', 'optional'])
  const result = await engine.fill(settings, scan.fields.map(field => ({ id: field.id, value: field.value })))
  assert.match(result, /1 temporary answer filled/)
  assert.equal(doc.querySelector<HTMLInputElement>('input[type=email]')?.value, 'real@example.com')
  assert.equal(doc.querySelector('textarea')?.value, '')
  assert.equal(doc.querySelector<HTMLInputElement>('input[name="entry.1"]')?.value, DEFAULT_SETTINGS.name)
  assert.equal(engine.scan().temporaryCount, 1)
})

test('rechecks stale plans and native validation before recording a fill', async () => {
  const { doc, engine } = setup(question('Name *', '<input required>') + question('Code *', '<input required pattern="[A-Z]{3}">'))
  const scan = engine.scan()
  doc.querySelector('input')!.value = 'My real answer'
  await engine.fill(DEFAULT_SETTINGS, scan.fields.map(field => ({ id: field.id, value: field.value })))
  assert.equal(doc.querySelector('input')!.value, 'My real answer')
  assert.equal(doc.querySelector<HTMLInputElement>('input[pattern]')!.value, '')
  assert.equal(engine.scan().temporaryCount, 0)
})

test('supports native and Google-style choices and never changes an existing selection', async () => {
  const { doc, engine } = setup(
    question('Pick *', '<div role="radiogroup"><div role="radio" aria-label="One" aria-checked="false" aria-required="true"></div><div role="radio" aria-label="Two" aria-checked="false"></div></div><button type="button">Clear selection</button>') +
    question('Already selected *', '<label><input type="radio" name="taken" checked required>A real choice</label>') +
    question('Check *', '<label><input type="checkbox" required>Agree</label>') +
    question('Menu *', '<select required><option value="">Choose</option><option value="a">Alpha</option></select>'),
  )
  const radios = [...doc.querySelectorAll('[role=radio]')]
  radios.forEach(radio => radio.addEventListener('click', () => radios.forEach(item => item.setAttribute('aria-checked', String(item === radio)))))
  doc.querySelector('button')!.addEventListener('click', () => radios.forEach(radio => radio.setAttribute('aria-checked', 'false')))
  const scan = engine.scan()
  await engine.fill(DEFAULT_SETTINGS, scan.fields.map(field => ({ id: field.id, value: field.value })))
  assert.equal(radios.find(radio => radio.getAttribute('aria-label') === scan.fields[0].value)!.getAttribute('aria-checked'), 'true')
  assert.equal(doc.querySelector<HTMLInputElement>('input[name=taken]')!.checked, true)
  assert.equal(doc.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked, true)
  assert.equal(doc.querySelector('select')!.value, 'a')
  assert.equal(engine.scan().temporaryCount, 3)
  await engine.clear()
  assert.ok(radios.every(radio => radio.getAttribute('aria-checked') === 'false'))
  assert.equal(doc.querySelector<HTMLInputElement>('input[name=taken]')!.checked, true)
  assert.equal(doc.querySelector('select')!.value, '')
  assert.equal(engine.scan().temporaryCount, 0)
})

test('fills and clears Google-style dropdowns through their actual option events', async () => {
  const { doc, engine } = setup(question('Menu *', '<div role="listbox" aria-required="true"><div role="option" data-value="" aria-selected="true">Choose</div><div role="option" data-value="Alpha" aria-selected="false">Alpha</div></div>'))
  const options = [...doc.querySelectorAll('[role=option]')]
  options.forEach(option => option.addEventListener('click', () => options.forEach(item => item.setAttribute('aria-selected', String(item === option)))))
  const scan = engine.scan()
  await engine.fill(DEFAULT_SETTINGS, scan.fields.map(field => ({ id: field.id, value: field.value })))
  assert.equal(options[1].getAttribute('aria-selected'), 'true')
  assert.equal(engine.scan().temporaryCount, 1)
  await engine.clear()
  assert.equal(options[0].getAttribute('aria-selected'), 'true')
  assert.equal(engine.scan().temporaryCount, 0)
})

test('clears only unchanged placeholders and carries tracking through a reload', async () => {
  const { doc, win, engine } = setup(question('Name *', '<input required>') + question('Notes *', '<textarea required></textarea>'))
  const scan = engine.scan()
  await engine.fill(DEFAULT_SETTINGS, scan.fields.map(field => ({ id: field.id, value: field.value })))
  doc.querySelector('textarea')!.value = 'Final answer'
  const restored = new FormEngine(doc, URL.replace('viewform', 'formResponse'), win.sessionStorage)
  assert.equal(restored.scan().temporaryCount, 1)
  await restored.clear()
  assert.equal(doc.querySelector('input')!.value, '')
  assert.equal(doc.querySelector('textarea')!.value, 'Final answer')
  assert.equal(restored.scan().temporaryCount, 0)
})

test('supports optional filling only when explicitly enabled and skips empty overrides', async () => {
  const { doc, engine } = setup(question('Notes', '<textarea></textarea>'))
  const settings = { ...DEFAULT_SETTINGS, includeOptional: true }
  const scan = engine.scan(settings)
  assert.equal(scan.fields[0].status, 'ready')
  await engine.fill(settings, [{ id: scan.fields[0].id, value: '' }])
  assert.equal(engine.scan().temporaryCount, 0)
  await engine.fill(settings, [{ id: scan.fields[0].id, value: 'Preview' }])
  assert.equal(doc.querySelector('textarea')!.value, 'Preview')
})

test('uploads, time and unsupported input types are untouched', async () => {
  const { doc, engine } = setup(question('Attachment *', '<input type="file" required>') + question('Time *', '<input type="time" required>') + question('Password *', '<input type="password" required>'))
  const scan = engine.scan()
  assert.deepEqual(scan.fields.map(field => field.status), ['manual', 'manual', 'manual'])
  await engine.fill(DEFAULT_SETTINGS, scan.fields.map(field => ({ id: field.id, value: 'unsafe' })))
  assert.equal(engine.scan().temporaryCount, 0)
  assert.ok([...doc.querySelectorAll('input')].every(input => input.value === ''))
})

test('blocks final submission while tracked answers remain, and allows Next and cleared submission', async () => {
  const { doc, win, engine } = setup(question('Name *', '<input required>') + '<div role="button" jsname="OCpkoe">Next</div><div role="button" jsname="M2UYVd"><span>Submit</span></div>')
  engine.installGuards()
  const scan = engine.scan()
  await engine.fill(DEFAULT_SETTINGS, scan.fields.map(field => ({ id: field.id, value: field.value })))
  const click = () => new win.MouseEvent('click', { bubbles: true, cancelable: true })
  assert.equal(doc.querySelector('[jsname=OCpkoe]')!.dispatchEvent(click()), true)
  assert.equal(doc.querySelector('[jsname=M2UYVd] span')!.dispatchEvent(click()), false)
  doc.querySelector('[jsname=OCpkoe]')!.remove()
  assert.equal(doc.querySelector('form')!.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })), false)
  await engine.clear()
  assert.equal(doc.querySelector('[jsname=M2UYVd]')!.dispatchEvent(click()), true)
})

test('retains records for other sections until the user returns to clear them', async () => {
  const { doc, engine } = setup(question('Earlier *', '<input required>', 'earlier'))
  const scan = engine.scan()
  await engine.fill(DEFAULT_SETTINGS, scan.fields.map(field => ({ id: field.id, value: field.value })))
  doc.querySelector('form')!.innerHTML = question('Later *', '<input required>', 'later')
  await engine.clear()
  assert.equal(engine.scan().temporaryCount, 1)
})

test('continues when session storage is blocked', async () => {
  const { doc } = setup(question('Name *', '<input required>'))
  const storage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } } as unknown as Storage
  const engine = new FormEngine(doc, URL, storage)
  const scan = engine.scan()
  await engine.fill(DEFAULT_SETTINGS, scan.fields.map(field => ({ id: field.id, value: field.value })))
  assert.equal(engine.scan().temporaryCount, 1)
})

test('does not fill an Other text box or select Other as a default', async () => {
  const { doc, engine } = setup(question('Pick *', '<div role="radio" data-value="__other_option__" aria-label="Other" aria-checked="false" aria-required="true"><input type="text"></div><div role="radio" data-value="Normal" aria-checked="false"></div>'))
  const controls = [...doc.querySelectorAll('[role=radio]')]
  controls.forEach(control => control.addEventListener('click', () => controls.forEach(item => item.setAttribute('aria-checked', String(item === control)))))
  const scan = engine.scan()
  assert.equal(scan.fields.length, 1)
  assert.deepEqual(scan.fields[0].options, ['Normal'])
  await engine.fill(DEFAULT_SETTINGS, scan.fields.map(field => ({ id: field.id, value: field.value })))
  assert.equal(doc.querySelector('input')!.value, '')
  assert.equal(controls[0].getAttribute('aria-checked'), 'false')
  assert.equal(controls[1].getAttribute('aria-checked'), 'true')
})

test('leaves composite inputs manual when no outline identifies their type', async () => {
  const { doc, engine } = setup(question('Date *', '<input required aria-label="Month"><input required aria-label="Day"><input required aria-label="Year">'))
  const scan = engine.scan()
  assert.equal(scan.fields.length, 1)
  assert.equal(scan.fields[0].status, 'manual')
  await engine.fill(DEFAULT_SETTINGS, [{ id: scan.fields[0].id, value: 'temporary' }])
  assert.ok([...doc.querySelectorAll('input')].every(input => input.value === ''))
})
