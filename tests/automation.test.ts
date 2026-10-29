import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { FormEngine } from '../src/content-script/engine.ts'
import { FormAutomation } from '../src/content-script/automation.ts'
import { DEFAULT_SETTINGS } from '../src/shared/types.ts'

const URL = 'https://docs.google.com/forms/d/e/example/viewform'
const question = (title: string, control = '<input required>', id = title) => `<div role="listitem" data-item-id="${id}"><div role="heading">${title}</div>${control}</div>`
const next = '<button type="button" jsname="OCpkoe">Next</button>'
const submit = '<button type="button" jsname="M2UYVd">Submit</button>'

function setup(body: string, stored: Record<string, string> = {}) {
  const dom = new JSDOM(`<title>Test form</title><form>${body}</form>`, { url: URL })
  const win = dom.window
  for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event', 'KeyboardEvent']) Object.defineProperty(globalThis, name, { configurable: true, value: win[name as keyof typeof win] })
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: win.getComputedStyle.bind(win) })
  for (const [key, value] of Object.entries(stored)) win.sessionStorage.setItem(key, value)
  const doc = win.document
  const engine = new FormEngine(doc, URL, win.sessionStorage)
  engine.installGuards()
  const runner = new FormAutomation(engine, doc, URL, win.sessionStorage)
  return { win, doc, engine, runner }
}

test('fills three sections automatically and stops before Submit', async t => {
  const { doc, win, runner } = setup(question('Name *') + next)
  t.after(() => win.close())
  const answers: string[] = []
  let submits = 0
  doc.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest('button')
    if (button?.getAttribute('jsname') === 'M2UYVd') submits++
    if (button?.getAttribute('jsname') !== 'OCpkoe') return
    answers.push(doc.querySelector('input')!.value)
    doc.querySelector('form')!.innerHTML = answers.length === 1 ? question('Age *') + next : question('Describe yourself *') + submit
  })
  runner.start(DEFAULT_SETTINGS)
  await runner.step()
  await runner.step()
  await runner.step()
  assert.deepEqual(answers, [DEFAULT_SETTINGS.name, DEFAULT_SETTINGS.age])
  assert.equal(doc.querySelector('input')!.value, '.')
  assert.equal(runner.status().status, 'complete')
  assert.equal(runner.status().pages, 3)
  assert.equal(submits, 0)
})

test('resumes on a new document after a full page navigation', async t => {
  const first = setup(question('Name *') + next)
  first.doc.querySelector('button')!.addEventListener('click', () => {})
  const settings = { ...DEFAULT_SETTINGS, name: 'Jordan Preview', email: 'jordan@gmail.com' }
  first.runner.start(settings)
  await first.runner.step()
  const stored = Object.fromEntries(Object.entries(first.win.sessionStorage))
  assert.ok(Object.values(stored).some(value => value.includes('waitingFrom')))
  first.win.close()
  const second = setup(question('Gmail *', '<input type="email" required>') + submit, stored)
  t.after(() => second.win.close())
  second.runner.resume(settings)
  await second.runner.step()
  assert.equal(second.doc.querySelector('input')!.value, settings.email)
  assert.equal(second.runner.status().status, 'complete')
  assert.equal(second.runner.status().pages, 2)
})

test('stops on validation instead of clicking through incomplete required answers', async t => {
  const { doc, win, runner } = setup(question('Code *', '<input required pattern="[A-Z]{3}">') + next)
  t.after(() => win.close())
  let clicks = 0
  doc.querySelector('button')!.addEventListener('click', () => clicks++)
  runner.start(DEFAULT_SETTINGS)
  await runner.step()
  assert.equal(runner.status().status, 'paused')
  assert.match(runner.status().message, /Code/)
  assert.equal(clicks, 0)
  assert.equal(doc.querySelector('input')!.value, '')
})

test('pauses for uploads, then continues after the user resolves the blocker', async t => {
  const { doc, win, runner } = setup(question('Resume *', '<input type="file" required>') + next)
  t.after(() => win.close())
  runner.start(DEFAULT_SETTINGS)
  await runner.step()
  assert.equal(runner.status().status, 'paused')
  assert.match(runner.status().message, /Resume/)
  doc.querySelector('input')!.disabled = true // Simulate a completed upload control.
  doc.querySelector('button')!.addEventListener('click', () => { doc.querySelector('form')!.innerHTML = question('About *') + submit })
  runner.start(DEFAULT_SETTINGS)
  await runner.step()
  await runner.step()
  assert.equal(runner.status().status, 'complete', runner.status().message)
})

test('Stop cancels pending work and remains paused after reload', async t => {
  const { doc, win, engine, runner } = setup(question('Name *') + next)
  t.after(() => win.close())
  let clicks = 0
  doc.querySelector('button')!.addEventListener('click', () => clicks++)
  runner.start(DEFAULT_SETTINGS)
  runner.stop()
  await runner.step()
  assert.equal(doc.querySelector('input')!.value, '')
  assert.equal(clicks, 0)
  const restored = new FormAutomation(engine, doc, URL, win.sessionStorage)
  restored.resume(DEFAULT_SETTINGS)
  assert.equal(restored.status().status, 'paused')
})

test('detects branching loops without refilling or clicking the repeated section', async t => {
  const { doc, win, runner } = setup(question('Name *', '<input required>', 'a') + next)
  t.after(() => win.close())
  let clicks = 0
  doc.addEventListener('click', event => {
    if ((event.target as HTMLElement).getAttribute('jsname') !== 'OCpkoe') return
    clicks++
    doc.querySelector('form')!.innerHTML = (clicks === 1 ? question('About *', '<input required>', 'b') : question('Name *', '<input required>', 'a')) + next
  })
  runner.start(DEFAULT_SETTINGS)
  await runner.step()
  await runner.step()
  await runner.step()
  assert.equal(runner.status().status, 'paused')
  assert.match(runner.status().message, /repeated section/)
  assert.equal(clicks, 2)
})

test('does not navigate when storage is blocked or a previous run expired', async t => {
  const { doc, win, engine } = setup(question('Name *') + next)
  t.after(() => win.close())
  const blocked = { getItem() { return null }, setItem() { throw new Error('blocked') } } as unknown as Storage
  const runner = new FormAutomation(engine, doc, URL, blocked)
  assert.equal(runner.start(DEFAULT_SETTINGS).status, 'paused')
  const key = 'formpass:run:/forms/d/e/example'
  win.sessionStorage.setItem(key, JSON.stringify({ status: 'running', pages: 1, visited: [], updatedAt: Date.now() - 610000 }))
  const expired = new FormAutomation(engine, doc, URL, win.sessionStorage)
  expired.resume(DEFAULT_SETTINGS)
  assert.equal(expired.status().status, 'paused')
  assert.match(expired.status().message, /expired/)
})

test('fills native and composite birthdays without overwriting existing date parts', async t => {
  const { doc, win, engine } = setup(question('Birthday *', '<input required type="date">') + question('Date of birth *', '<input aria-label="Year" value="1990" required><input aria-label="Month" required><input aria-label="Day" required>'))
  t.after(() => win.close())
  const scan = engine.scan(DEFAULT_SETTINGS)
  await engine.fill(DEFAULT_SETTINGS, scan.fields.filter(field => field.status === 'ready').map(field => ({ id: field.id, value: field.value })))
  assert.equal(doc.querySelector<HTMLInputElement>('input[type=date]')!.value, DEFAULT_SETTINGS.birthday)
  assert.equal(doc.querySelector<HTMLInputElement>('input[aria-label=Year]')!.value, '1990')
  assert.equal(doc.querySelector<HTMLInputElement>('input[aria-label=Month]')!.value, '1')
  assert.equal(doc.querySelector<HTMLInputElement>('input[aria-label=Day]')!.value, '1')
  await engine.clear()
  assert.equal(doc.querySelector<HTMLInputElement>('input[aria-label=Year]')!.value, '1990')
  assert.equal(doc.querySelector<HTMLInputElement>('input[aria-label=Month]')!.value, '')
})

test('fills grid rows separately and keeps answered rows', async t => {
  const row = (name: string, checked = false) => `<div role="radiogroup" aria-label="${name}"><div role="radio" aria-required="true" aria-checked="${checked}" data-value="Yes"></div><div role="radio" aria-checked="false" data-value="No"></div></div>`
  const { doc, win, engine } = setup(question('Availability *', row('Monday', true) + row('Tuesday')))
  t.after(() => win.close())
  doc.querySelectorAll('[role=radio]').forEach(control => control.addEventListener('click', () => control.setAttribute('aria-checked', 'true')))
  const scan = engine.scan()
  assert.deepEqual(scan.fields.map(field => field.status), ['answered', 'ready'])
  await engine.fill(DEFAULT_SETTINGS, scan.fields.map(field => ({ id: field.id, value: field.value })))
  assert.equal(doc.querySelector('[aria-label=Monday] [data-value=Yes]')!.getAttribute('aria-checked'), 'true')
  assert.equal(doc.querySelector('[aria-label=Tuesday] [data-value=No]')!.getAttribute('aria-checked'), 'true')
})

test('never clicks a Submit control even when its visible label says Next', async t => {
  const { doc, win, runner } = setup(question('Name *') + '<button type="button" jsname="M2UYVd">Next</button>')
  t.after(() => win.close())
  let clicks = 0
  doc.querySelector('button')!.addEventListener('click', () => clicks++)
  runner.start(DEFAULT_SETTINGS)
  await runner.step()
  assert.equal(runner.status().status, 'complete')
  assert.equal(clicks, 0)
})

test('pauses when Google does not advance instead of repeatedly clicking Next', async t => {
  const { doc, win, engine, runner } = setup(question('About *') + next)
  t.after(() => win.close())
  let clicks = 0
  doc.querySelector('button')!.addEventListener('click', () => clicks++)
  runner.start(DEFAULT_SETTINGS)
  await runner.step()
  const key = 'formpass:run:/forms/d/e/example'
  const stored = JSON.parse(win.sessionStorage.getItem(key)!)
  stored.waitingSince = Date.now() - 9000
  win.sessionStorage.setItem(key, JSON.stringify(stored))
  const resumed = new FormAutomation(engine, doc, URL, win.sessionStorage)
  resumed.resume(DEFAULT_SETTINGS)
  await resumed.step()
  assert.equal(resumed.status().status, 'paused')
  assert.match(resumed.status().message, /did not advance/)
  assert.equal(clicks, 1)
})

test('advances through an empty introductory section that exposes form metadata', async t => {
  const { doc, win, engine, runner } = setup('<div role="heading">Welcome</div>' + next)
  t.after(() => win.close())
  const schema = doc.createElement('script')
  schema.textContent = `var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, [null, [[1, 'Name', null, 0, [[11, null, 1]]]]]])};`
  doc.body.append(schema)
  assert.equal(engine.scan().isGoogleForm, true)
  doc.querySelector('button')!.addEventListener('click', () => { doc.querySelector('form')!.innerHTML = question('Name *') + submit })
  runner.start(DEFAULT_SETTINGS)
  await runner.step()
  await runner.step()
  assert.equal(runner.status().status, 'complete')
  assert.equal(runner.status().pages, 2)
})

test('an explicit manual opt-out pauses without opening the picker', async t => {
  const { doc, win, runner } = setup(question('Resume *', '<button type="button">Add file</button>') + next)
  t.after(() => win.close())
  let clicked = 0
  doc.querySelectorAll('button').forEach(button => button.addEventListener('click', () => clicked++))
  runner.start({ ...DEFAULT_SETTINGS, fileMode: 'download', attachFiles: false })
  await runner.step()
  assert.equal(runner.status().status, 'paused')
  assert.match(runner.status().message, /Manual download/)
  assert.equal(clicked, 0)
})
