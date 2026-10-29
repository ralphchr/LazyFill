import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { googleUploadValue, pickerDocuments, uploadThroughPicker } from '../src/content-script/uploads.ts'
import { FormEngine } from '../src/content-script/engine.ts'
import { DEFAULT_SETTINGS } from '../src/shared/types.ts'

const url = 'https://docs.google.com/forms/d/e/upload-test/viewform'

function setup() {
  const dom = new JSDOM('<form><div role="listitem" data-item-id="resume"><div role="heading">Resume *</div><button type="button">Add file</button></div><input type="hidden" name="entry.123" value=""></form>', { url })
  const win = dom.window
  const doc = win.document
  const question = doc.querySelector<HTMLElement>('[role=listitem]')!
  const button = question.querySelector('button')!
  for (const name of ['HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Event']) Object.defineProperty(globalThis, name, { configurable: true, value: win[name as keyof typeof win] })
  Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: win.getComputedStyle.bind(win) })
  const originalTransfer = Object.getOwnPropertyDescriptor(globalThis, 'DataTransfer')
  class Transfer {
    files: File[] = []
    items = { add: (file: File) => this.files.push(file) }
  }
  Object.defineProperty(globalThis, 'DataTransfer', { configurable: true, value: Transfer })
  function cleanup() {
    dom.window.close()
    if (originalTransfer) Object.defineProperty(globalThis, 'DataTransfer', originalTransfer)
    else Reflect.deleteProperty(globalThis, 'DataTransfer')
  }
  function openPicker(native = true, accept = 'application/pdf') {
    const frame = doc.createElement('iframe')
    frame.src = `https://docs.google.com/picker?hostId=file-upload&selectableMimeTypes=${encodeURIComponent(accept)}`
    doc.body.append(frame)
    const picker = frame.contentDocument!
    picker.open()
    picker.write('<!doctype html><html><body><div role="tab" aria-selected="true">Upload</div><div role="group" id="drop"><button id="uploadButtonId">Browse</button></div></body></html>')
    picker.close()
    let files: File[] = []
    let input: HTMLInputElement | undefined
    if (native) {
      input = picker.createElement('input')
      input.type = 'file'
      input.accept = accept
      Object.defineProperty(input, 'files', { get: () => files, set: value => { files = [...value] } })
      picker.body.append(input)
    }
    class Drag extends picker.defaultView!.Event {
      dataTransfer: unknown
      constructor(type: string, init: EventInit & { dataTransfer: unknown }) { super(type, init); this.dataTransfer = init.dataTransfer }
    }
    Object.defineProperty(picker.defaultView, 'DragEvent', { value: Drag })
    return { frame, picker, input, files: () => files }
  }
  const complete = (frame: HTMLIFrameElement, name: string) => {
    doc.querySelector<HTMLInputElement>('[name="entry.123"]')!.value = '["drive-file-id"]'
    const caption = doc.createElement('span')
    caption.textContent = name
    question.append(caption)
    const remove = doc.createElement('button')
    remove.type = 'button'
    remove.setAttribute('aria-label', 'Remove file')
    remove.addEventListener('click', () => { doc.querySelector<HTMLInputElement>('[name="entry.123"]')!.value = ''; caption.remove(); remove.remove() })
    question.append(remove)
    frame.hidden = true
  }
  return { win, doc, question, button, cleanup, openPicker, complete }
}

test('uploads into the Google picker frame and waits for an actual form attachment', async t => {
  const app = setup()
  t.after(app.cleanup)
  let selected: File | undefined
  let confirmed = false
  app.button.addEventListener('click', () => {
    const { frame, input, files } = app.openPicker()
    input!.addEventListener('change', () => {
      selected = files()[0]
      app.win.setTimeout(() => { app.complete(frame, selected!.name); confirmed = true }, 25)
    })
  })
  const result = await uploadThroughPicker({ ...app, kind: 'random', entryIds: ['123'], timeoutMs: 300, pollMs: 5 })
  assert.equal(result.ok, true, result.message)
  assert.equal(confirmed, true)
  assert.equal(selected!.type, 'application/pdf')
  assert.match(googleUploadValue(app.question, ['123']), /drive-file-id/)
})

test('uses the picker drop zone when no native input exists', async t => {
  const app = setup()
  t.after(app.cleanup)
  let dropped = false
  let browseClicked = false
  app.button.addEventListener('click', () => {
    const { frame, picker } = app.openPicker(false, 'image/png')
    picker.getElementById('uploadButtonId')!.addEventListener('click', () => { browseClicked = true })
    picker.getElementById('drop')!.addEventListener('drop', event => {
      const file = (event as unknown as { dataTransfer: { files: File[] } }).dataTransfer.files[0]
      assert.equal(file.type, 'image/png')
      dropped = true
      app.complete(frame, file.name)
    })
  })
  const result = await uploadThroughPicker({ ...app, kind: 'random', entryIds: ['123'], timeoutMs: 300, pollMs: 5 })
  assert.equal(result.ok, true, result.message)
  assert.equal(dropped, true)
  assert.equal(browseClicked, false) // Do not open the operating system file chooser.
})

test('does not report success merely because a FileList changed or a picker closed', async t => {
  const app = setup()
  t.after(app.cleanup)
  app.button.addEventListener('click', () => {
    const { frame, input } = app.openPicker()
    input!.addEventListener('change', () => { frame.hidden = true })
  })
  const result = await uploadThroughPicker({ ...app, kind: 'pdf', entryIds: ['123'], timeoutMs: 70, pollMs: 5 })
  assert.equal(result.ok, false)
  assert.match(result.message!, /not confirmed/)
  assert.equal(googleUploadValue(app.question, ['123']), '[]')
})

test('preserves existing uploads and an already-open user picker', async t => {
  const app = setup()
  t.after(app.cleanup)
  app.openPicker()
  let clicked = false
  app.button.addEventListener('click', () => { clicked = true })
  const result = await uploadThroughPicker({ ...app, kind: 'pdf', entryIds: ['123'], timeoutMs: 70, pollMs: 5 })
  assert.equal(result.ok, false)
  assert.match(result.message!, /Close the open/)
  assert.equal(clicked, false)
  assert.equal(pickerDocuments(app.doc).length, 1)
})

test('rejects incompatible types and stops without transferring a file', async t => {
  const app = setup()
  t.after(app.cleanup)
  let prepared = false
  app.button.addEventListener('click', () => { app.openPicker(true, 'application/pdf') })
  const result = await uploadThroughPicker({ ...app, kind: 'png', entryIds: ['123'], prepared: () => { prepared = true }, timeoutMs: 70, pollMs: 5 })
  assert.equal(result.ok, false)
  assert.match(result.message!, /does not accept/)
  assert.equal(prepared, false)
})

test('cancels a pending transfer without clicking Select', async t => {
  const app = setup()
  t.after(app.cleanup)
  let active = true
  let selectClicked = false
  app.button.addEventListener('click', () => {
    const { picker, input, files } = app.openPicker()
    input!.addEventListener('change', () => {
      picker.body.append(files()[0].name)
      const select = picker.createElement('button')
      select.textContent = 'Select'
      select.addEventListener('click', () => { selectClicked = true })
      picker.body.append(select)
      active = false
    })
  })
  const result = await uploadThroughPicker({ ...app, kind: 'pdf', entryIds: ['123'], active: () => active, timeoutMs: 70, pollMs: 5 })
  assert.equal(result.cancelled, true)
  assert.equal(selectClicked, false)
})

test('engine tracks picker uploads across scans and keeps question identity stable', async t => {
  const app = setup()
  t.after(app.cleanup)
  const schema = app.doc.createElement('script')
  schema.textContent = `var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, [null, [[1, 'Resume', null, 13, [[123, null, 1]]]]]])};`
  app.doc.body.append(schema)
  app.button.addEventListener('click', () => {
    const { frame, input, files } = app.openPicker()
    input!.addEventListener('change', () => { app.complete(frame, files()[0].name) })
  })
  const engine = new FormEngine(app.doc, url, app.win.sessionStorage)
  const scan = engine.scan(DEFAULT_SETTINGS)
  const fingerprint = engine.pageFingerprint()
  assert.equal(scan.fields[0].status, 'ready')
  await engine.fill(DEFAULT_SETTINGS, scan.fields.map(field => ({ id: field.id, value: field.value })))
  assert.equal(engine.scan().fields[0].status, 'answered')
  assert.equal(engine.scan().temporaryCount, 1)
  assert.equal(engine.pageFingerprint(), fingerprint)
  const restored = new FormEngine(app.doc, url, app.win.sessionStorage)
  assert.equal(restored.scan().temporaryCount, 1)
  await restored.clear()
  assert.equal(restored.scan().temporaryCount, 0)
  assert.equal(googleUploadValue(app.question, ['123']), '[]')
})

test('explicit clearing resets a cancelled pending attempt only after the picker closes', async t => {
  const app = setup()
  t.after(app.cleanup)
  const key = 'formpass:temporary:/forms/d/e/upload-test'
  const engine = new FormEngine(app.doc, url, app.win.sessionStorage)
  const scan = engine.scan()
  app.win.sessionStorage.setItem(key, JSON.stringify([{ id: scan.fields[0].id, value: '[]', pending: true, uploadName: 'formpass-blank-123456.pdf' }]))
  const restored = new FormEngine(app.doc, url, app.win.sessionStorage)
  const picker = app.openPicker()
  await assert.rejects(() => restored.clear(), /close Google/)
  assert.equal(restored.scan().temporaryCount, 1)
  picker.frame.hidden = true
  await restored.clear()
  assert.equal(restored.scan().temporaryCount, 0)
})

test('a template link in an upload question is not mistaken for an attachment', t => {
  const app = setup()
  t.after(app.cleanup)
  const link = app.doc.createElement('a')
  link.href = 'https://drive.google.com/file/d/template-id/view'
  link.textContent = 'Download this template first'
  app.question.append(link)
  assert.equal(googleUploadValue(app.question, ['123']), '[]')
})

test('confirms the uploaded filename before clicking the picker Select button', async t => {
  const app = setup()
  t.after(app.cleanup)
  let selected = false
  app.button.addEventListener('click', () => {
    const { frame, picker, input, files } = app.openPicker()
    input!.addEventListener('change', () => {
      picker.body.append(files()[0].name)
      const select = picker.createElement('button')
      select.textContent = 'Select'
      select.addEventListener('click', () => { selected = true; app.complete(frame, files()[0].name) })
      picker.body.append(select)
    })
  })
  const result = await uploadThroughPicker({ ...app, kind: 'pdf', entryIds: ['123'], timeoutMs: 500, pollMs: 5 })
  assert.equal(result.ok, true, result.message)
  assert.equal(selected, true)
})

test('reports Google upload rejection instead of counting the file as attached', async t => {
  const app = setup()
  t.after(app.cleanup)
  app.button.addEventListener('click', () => {
    const { picker, input } = app.openPicker()
    input!.addEventListener('change', () => { const error = picker.createElement('p'); error.setAttribute('role', 'alert'); error.textContent = 'This file type is not supported'; picker.body.append(error) })
  })
  const result = await uploadThroughPicker({ ...app, kind: 'pdf', entryIds: ['123'], timeoutMs: 500, pollMs: 5 })
  assert.equal(result.ok, false)
  assert.match(result.message!, /not supported/)
  assert.equal(googleUploadValue(app.question, ['123']), '[]')
})

test('random picker uploads prefer nonempty blank files but retain text-only compatibility', async t => {
  const app = setup()
  t.after(app.cleanup)
  let accepted = 'image/png,application/pdf,text/plain'
  let received: File | undefined
  app.button.addEventListener('click', () => {
    const { frame, input, files } = app.openPicker(true, accepted)
    input!.addEventListener('change', () => { received = files()[0]; app.complete(frame, received.name) })
  })
  assert.equal((await uploadThroughPicker({ ...app, kind: 'random', entryIds: ['123'], timeoutMs: 500, pollMs: 5 })).ok, true)
  assert.ok(received!.size > 0)
  app.doc.querySelector<HTMLButtonElement>('[aria-label="Remove file"]')!.click()
  accepted = 'text/plain'
  assert.equal((await uploadThroughPicker({ ...app, kind: 'random', entryIds: ['123'], timeoutMs: 500, pollMs: 5 })).ok, true)
  assert.equal(received!.type, 'text/plain')
  assert.equal(received!.size, 0)
})
