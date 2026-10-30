import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { IDBFactory } from 'fake-indexeddb'

const indexedDB = new IDBFactory()
const stored = {}
const storage = { local: { get: async () => stored, set: async value => Object.assign(stored, value) } }
const contentScript = await readFile('dist/content.js', 'utf8')
const html = await readFile('dist/popup.html', 'utf8')
const scriptPath = html.match(/<script[^>]*src="([^"]+)"/)?.[1]
assert.ok(scriptPath)
const popupScript = await readFile(`dist/${scriptPath.replace(/^\.\//, '')}`, 'utf8')
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'))
assert.equal(manifest.background.service_worker, 'background.js')
const background = new JSDOM('', { url: 'https://extension.test/background', runScripts: 'outside-only' })
background.window.indexedDB = indexedDB
let fileListener
background.window.chrome = { runtime: { id: 'package-test', onMessage: { addListener(callback) { fileListener = callback } } } }
background.window.eval(await readFile('dist/background.js', 'utf8'))
const fileRequest = message => new Promise(resolve => fileListener(message, { id: 'package-test' }, resolve))

function contentWindow(markup, id) {
  const dom = new JSDOM(`<title>Application preview - Google Forms</title>${markup}`, { url: `https://docs.google.com/forms/d/e/${id}/viewform`, runScripts: 'outside-only' })
  dom.window.File = File
  dom.window.TextEncoder = TextEncoder
  dom.window.DataTransfer = class { files = []; items = { add: file => this.files.push(file) } }
  let listener
  dom.window.chrome = { storage, runtime: { id: 'package-test', sendMessage: fileRequest, onMessage: { addListener(callback) { listener = callback } } } }
  dom.window.eval(contentScript)
  assert.equal(typeof listener, 'function')
  return { dom, request: message => new Promise(resolve => listener(message, { id: 'package-test' }, resolve)) }
}

function openPopup(app, url = app.dom.window.location.href) {
  const popup = new JSDOM(html, { url: 'https://extension.test/popup.html', runScripts: 'outside-only', pretendToBeVisual: true })
  popup.window.indexedDB = indexedDB
  popup.window.TextEncoder = TextEncoder
  popup.window.File = File
  popup.window.chrome = { tabs: { query: async () => [{ id: 1, url }], sendMessage: async (_id, message) => app.request(message) }, storage }
  popup.window.eval(popupScript)
  return popup
}

async function until(predicate, message) {
  for (let i = 0; i < 500; i++) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(message)
}

const fixture = await readFile('tests/fixtures/popup.html', 'utf8')
const formMarkup = fixture.match(/<form>([\s\S]*?)<\/form>/)?.[1]
const app = contentWindow(`<form>${formMarkup}</form>`, 'package-test')
const popup = openPopup(app)
const doc = popup.window.document
await until(() => doc.querySelector('.connected'), 'Popup must connect')
assert.equal(doc.querySelectorAll('.profile-grid input').length, 5)
assert.equal(doc.querySelector('[name=contact]').value, '0')
assert.equal(doc.querySelector('.generate-file'), null)
assert.ok(doc.querySelector('[aria-label="Upload temporary files"]'))
doc.querySelector('.questions').open = true
const tool = text => [...doc.querySelectorAll('.tools button')].find(button => button.textContent === text)
tool('Fill this page').click()
await until(() => doc.querySelector('.success')?.textContent.includes('3 temporary answers filled'), 'Fill page must preserve existing answers')
assert.equal(app.dom.window.document.querySelector('[name="entry.1"]').value, 'Test User')
assert.equal(app.dom.window.document.querySelector('input[type=email]').value, 'your.real.answer@example.com')
assert.equal(app.dom.window.document.querySelector('textarea').value, '.')
tool('Clear this page').click()
await until(() => doc.querySelector('.success')?.textContent.includes('3 temporary answers cleared'), 'Clear must remove only placeholders')
let nextClicks = 0
let submits = 0
const form = app.dom.window.document.querySelector('form')
app.dom.window.document.addEventListener('click', event => {
  if (event.target.getAttribute('jsname') === 'M2UYVd') submits++
})
form.querySelector('[jsname=OCpkoe]').addEventListener('click', () => {
  nextClicks++
  form.innerHTML = '<div role="listitem" data-item-id="about"><div role="heading">About *</div><textarea required></textarea></div><button type="button" jsname="M2UYVd">Submit</button>'
})
doc.querySelector('.primary').click()
await until(() => doc.querySelector('.run-status.paused'), 'Required missing upload must pause')
assert.match(doc.querySelector('.run-status').textContent, /File needed: Resume/)
assert.equal(nextClicks, 0)
doc.querySelector('.primary').click()
await until(() => doc.querySelector('.run-status.paused') && !doc.querySelector('.primary').disabled, 'Continue without a file must pause again')
assert.equal(nextClicks, 0)
// Simulate an upload completed directly in the Google Form.
form.querySelector('input[type=file]').disabled = true
doc.querySelector('.primary').click()
await until(() => doc.querySelector('.run-status.running'), 'Continue must run after the blocker is resolved')
popup.window.close()
await until(async () => (await app.request({ type: 'SCAN', settings: stored.settings })).scan.automation.status === 'complete', 'Run must continue after popup closure')
assert.equal(nextClicks, 1)
assert.equal(submits, 0)
app.dom.window.close()

// Full UI → durable file store → worker chunks → content script → Google picker.
const upload = contentWindow('<form><label>Email address *<input name="emailAddress" type="email" required></label><div role="listitem" data-item-id="resume"><div role="heading">Resume *</div><button type="button">Add file</button></div><input type="hidden" name="entry.123"><button type="button" jsname="OCpkoe">Next</button></form>', 'picker-package-test')
const uploadDoc = upload.dom.window.document
const schema = uploadDoc.createElement('script')
schema.textContent = `var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, [null, [[1, 'Resume', null, 13, [[123, null, 1]]]]]])};`
uploadDoc.body.append(schema)
let uploadedFile
let confirmed = false
let uploadNext = 0
uploadDoc.addEventListener('click', event => { if (event.target.getAttribute('jsname') === 'M2UYVd') submits++ })
uploadDoc.querySelector('[jsname=OCpkoe]').addEventListener('click', () => {
  assert.equal(confirmed, true, 'Next must wait for the attachment')
  uploadNext++
  uploadDoc.querySelector('form').innerHTML = '<div role="listitem" data-item-id="last"><div role="heading">Final notes *</div><textarea required></textarea></div><button type="button" jsname="M2UYVd">Submit</button>'
})
uploadDoc.querySelector('[role=listitem] button').addEventListener('click', () => {
  const frame = uploadDoc.createElement('iframe')
  frame.src = 'https://docs.google.com/picker?hostId=file-upload&selectableMimeTypes=application%2Fpdf'
  uploadDoc.body.append(frame)
  const picker = frame.contentDocument
  picker.open(); picker.write('<html><body><input type="file" accept="application/pdf"></body></html>'); picker.close()
  const input = picker.querySelector('input')
  let files = []
  Object.defineProperty(input, 'files', { get: () => files, set: value => { files = [...value] } })
  input.addEventListener('change', () => {
    uploadedFile = files[0]
    upload.dom.window.setTimeout(() => {
      uploadDoc.querySelector('[name="entry.123"]').value = '["drive-id"]'
      uploadDoc.querySelector('[role=listitem]').append(uploadedFile.name)
      frame.hidden = true; confirmed = true
    }, 50)
  })
})
const uploadPopup = openPopup(upload)
const uploadUI = uploadPopup.window.document
await until(() => uploadUI.querySelector('.connected'), 'Upload popup must connect')
uploadUI.querySelector('.primary').click()
await until(() => uploadUI.querySelector('.run-status.paused'), 'Missing library file must block the run')
assert.equal(uploadedFile, undefined)
assert.equal(uploadNext, 0)
const bytes = Uint8Array.from({ length: 600_123 }, (_, index) => index % 251)
const chosenFile = new File([bytes], 'my-chosen-file.pdf', { type: 'application/pdf', lastModified: 12345 })
const otherFile = new File(['different user-selected file'], 'other-file.pdf', { type: 'application/pdf' })
const input = uploadUI.querySelector('[aria-label="Upload temporary files"]')
Object.defineProperty(input, 'files', { configurable: true, value: [otherFile, chosenFile] })
input.dispatchEvent(new uploadPopup.window.Event('change', { bubbles: true }))
await until(() => uploadUI.querySelector('.file-list')?.textContent.includes(chosenFile.name) && !uploadUI.querySelector('.primary').disabled, 'Chosen file must be stored and listed')
assert.equal(stored.settings.uploadFiles.length, 2)
const assignedId = stored.settings.uploadFiles.find(file => file.name === chosenFile.name).id
const assignment = uploadUI.querySelector('[aria-label="File for Resume"]')
assignment.value = assignedId
assignment.dispatchEvent(new uploadPopup.window.Event('change', { bubbles: true }))
await until(() => Object.values(stored.settings.uploadAssignments).includes(assignedId) && !uploadUI.querySelector('.primary').disabled, 'Explicit assignment must be persisted')
uploadPopup.window.close()
const reopened = openPopup(upload)
await until(() => reopened.window.document.querySelector('.file-list')?.textContent.includes(chosenFile.name), 'File must survive popup closure')
reopened.window.document.querySelector('.primary').click()
await until(() => reopened.window.document.querySelector('.run-status.running'), 'Selected file must unblock Continue')
reopened.window.close()
await until(async () => (await upload.request({ type: 'SCAN', settings: stored.settings })).scan.automation.status === 'complete', 'Chosen file must attach before continuing to the final section')
assert.equal(uploadedFile.name, chosenFile.name)
assert.equal(uploadedFile.type, chosenFile.type)
assert.deepEqual(new Uint8Array(await uploadedFile.arrayBuffer()), bytes)
assert.equal(uploadNext, 1)
assert.equal(submits, 0)
const cleanup = openPopup(upload)
await until(() => cleanup.window.document.querySelector('.file-list'), 'Uploaded file remains in the local library')
cleanup.window.document.querySelector(`[aria-label="Remove ${chosenFile.name}"]`).click()
await until(() => stored.settings.uploadFiles.length === 1, 'Removing a file must update the persisted library')
assert.ok(Object.values(stored.settings.uploadAssignments).includes(assignedId), 'Removing an assigned file must not silently choose another')
await until(() => !cleanup.window.document.querySelector('.icon-button').disabled, 'File removal must finish')
cleanup.window.document.querySelector(`[aria-label="Remove ${otherFile.name}"]`).click()
await until(() => stored.settings.uploadFiles.length === 0, 'Remaining library file can be removed')
cleanup.window.close()
const independent = openPopup(upload, 'https://example.com')
await until(() => independent.window.document.querySelector('.file-input')?.disabled === false, 'Files can be prepared on non-form tabs')
assert.equal(independent.window.document.querySelector('.file-list'), null)
independent.window.close(); upload.dom.window.close(); background.window.close()
console.log('Packaged extension passed: selected-file persistence, exact multi-chunk transfer through the worker/picker, missing-file gates, continuation, existing answers, and no submission.')
