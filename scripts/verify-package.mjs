import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'

const fixture = await readFile('tests/fixtures/popup.html', 'utf8')
const formMarkup = fixture.match(/<form>([\s\S]*?)<\/form>/)?.[1]
assert.ok(formMarkup, 'The fixture must include form controls')
const form = new JSDOM(`<title>Application preview - Google Forms</title><form>${formMarkup}</form>`, {
  url: 'https://docs.google.com/forms/d/e/package-test/viewform', runScripts: 'outside-only',
})
const data = [null, [null, [[1, 'Full name', null, 0, [[11, null, 1]]], [2, 'Later section', null, 8], [3, 'Project description', null, 1, [[12, null, 1]]]]]]
const schema = form.window.document.createElement('script')
schema.textContent = `var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(data)};`
form.window.document.body.append(schema)
let listener
const stored = {}
const storage = { local: { get: async () => stored, set: async value => Object.assign(stored, value) } }
form.window.chrome = { storage, runtime: { id: 'package-test', onMessage: { addListener(callback) { listener = callback } } } }
form.window.eval(await readFile('dist/content.js', 'utf8'))
assert.equal(typeof listener, 'function', 'Packaged content script must register messaging')
const request = message => new Promise(resolve => listener(message, { id: 'package-test' }, resolve))

const html = await readFile('dist/popup.html', 'utf8')
const scriptPath = html.match(/<script[^>]*src="([^"]+)"/)?.[1]
assert.ok(scriptPath, 'Packaged popup must reference its bundle')
const popupScript = await readFile(`dist/${scriptPath.replace(/^\.\//, '')}`, 'utf8')
const generatedFiles = []
const downloadedFiles = []
function openPopup(tabUrl = form.window.location.href) {
  const popup = new JSDOM(html, { url: 'https://extension.test/popup.html', runScripts: 'outside-only', pretendToBeVisual: true })
  popup.window.TextEncoder = TextEncoder
  popup.window.URL.createObjectURL = file => { generatedFiles.push(file); return `blob:https://extension.test/generated-${generatedFiles.length}` }
  popup.window.URL.revokeObjectURL = () => {}
  popup.window.HTMLAnchorElement.prototype.click = function () { downloadedFiles.push({ href: this.href, name: this.download }) }
  popup.window.chrome = {
    tabs: { query: async () => [{ id: 1, url: tabUrl }], sendMessage: async (_id, message) => request(message) },
    storage,
  }
  popup.window.eval(popupScript)
  return popup
}
async function until(predicate, message) {
  for (let i = 0; i < 400; i++) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(message)
}
const popup = openPopup()
const doc = popup.window.document
await until(() => doc.querySelector('.connected'), 'The packaged popup must connect')
assert.match(doc.body.textContent, /Application preview/)
assert.equal(doc.querySelectorAll('.profile-grid input').length, 5)
assert.equal(doc.querySelector('input[name=contact]').value, '0')
assert.equal(doc.querySelectorAll('.questions').length, 1)
assert.ok(doc.querySelector('.generate-file'))
assert.equal(doc.querySelector('.file-generator').open, false)
doc.querySelector('.file-generator').open = true
const format = doc.querySelector('[aria-label="Blank file type"]')
format.value = 'pdf'
format.dispatchEvent(new popup.window.Event('change', { bubbles: true }))
await new Promise(resolve => setTimeout(resolve, 0))
doc.querySelector('.generate-file').click()
await until(() => doc.querySelector('.success')?.textContent.includes('Generated'), 'The extension must generate a downloadable blank file')
assert.equal(generatedFiles[0].type, 'application/pdf')
assert.ok(generatedFiles[0].size > 0)
assert.match(downloadedFiles[0].name, /^formpass-blank-[a-f0-9]{6}\.pdf$/)
assert.equal(stored.settings.fileMode, 'attach')
assert.equal(stored.settings.attachFiles, true)
const tool = text => [...doc.querySelectorAll('.tools button')].find(button => button.textContent === text)
tool('Fill this page').click()
await until(() => doc.querySelector('.success')?.textContent.includes('3 temporary answers filled'), 'Fill this page must reach the packaged content script')
assert.equal(form.window.document.querySelector('[name="entry.1"]').value, 'Test User')
assert.equal(form.window.document.querySelector('input[type=email]').value, 'your.real.answer@example.com')
assert.ok(['design', 'engineering'].includes(form.window.document.querySelector('select').value))
assert.equal(form.window.document.querySelector('textarea').value, '.')
assert.ok(form.window.document.querySelector('#formpass-notice'))
assert.match(doc.querySelector('.outline').textContent, /Project description/)
tool('Clear this page').click()
await until(() => doc.querySelector('.success')?.textContent.includes('3 temporary answers cleared'), 'Clear must preserve existing answers')
assert.equal(form.window.document.querySelector('[name="entry.1"]').value, '')
assert.equal(form.window.document.querySelector('select').value, '')
assert.equal(form.window.document.querySelector('input[type=email]').value, 'your.real.answer@example.com')

// Test the actual built runner independently of the popup's lifetime.
form.window.document.querySelector('input[type=file]').disabled = true
let submits = 0
let firstPageName = ''
form.window.document.addEventListener('click', event => {
  if (event.target.getAttribute('jsname') === 'M2UYVd') submits++
})
form.window.document.querySelector('form [jsname=OCpkoe]').addEventListener('click', () => {
  firstPageName = form.window.document.querySelector('[name="entry.1"]').value
  form.window.document.querySelector('form').innerHTML = '<div role="listitem" data-item-id="about"><div role="heading">About *</div><textarea required></textarea></div><div role="listitem" data-item-id="birthday"><div role="heading">Birthday *</div><input type="date" required></div><div role="listitem" data-item-id="age"><div role="heading">Age *</div><input type="number" required></div><div role="listitem" data-item-id="phone"><div role="heading">Contact number *</div><input type="tel" required></div><div role="listitem" data-item-id="count"><div role="heading">Quantity *</div><input type="number" required></div><div role="listitem" data-item-id="code"><div role="heading">Code *</div><input pattern="[A-Za-z0-9]{4}" required></div><button type="button" jsname="M2UYVd">Submit</button>'
})
doc.querySelector('.primary').click()
await until(() => doc.querySelector('.run-status.running'), 'Run all sections must start')
popup.window.close()
await until(async () => (await request({ type: 'SCAN', settings: stored.settings })).scan.automation.status === 'complete', 'Automation must finish after the popup closes')
assert.equal(firstPageName, 'Test User')
assert.equal(form.window.document.querySelector('textarea').value, '.')
assert.equal(form.window.document.querySelector('input[type=date]').value, '2000-01-01')
assert.equal(form.window.document.querySelector('input[type=number]').value, '26')
assert.equal(form.window.document.querySelector('input[type=tel]').value, '0')
assert.equal(form.window.document.querySelector('[data-item-id=count] input').value, '0')
assert.match(form.window.document.querySelector('[data-item-id=code] input').value, /^[A-Za-z0-9]{4}$/)
assert.equal(submits, 0)
const reopened = openPopup()
await until(() => reopened.window.document.querySelector('.run-status.complete'), 'Reopened popup must recover completed progress')
reopened.window.close()
const independent = openPopup('https://example.com')
await until(() => independent.window.document.querySelector('.generate-file')?.disabled === false, 'File generation must be available without a Google Form')
independent.window.document.querySelector('.file-generator').open = true
independent.window.document.querySelector('.generate-file').click()
await until(() => downloadedFiles.length === 2, 'File generation must work on an unsupported tab')
independent.window.close()
form.window.close()
// Exercise the actual bundle against a separate Google-style picker frame.
const uploadForm = new JSDOM('<form><div role="listitem" data-item-id="resume"><div role="heading">Resume *</div><button type="button">Add file</button></div><input type="hidden" name="entry.123"><button type="button" jsname="M2UYVd">Submit</button></form>', { url: 'https://docs.google.com/forms/d/e/picker-package-test/viewform', runScripts: 'outside-only' })
uploadForm.window.TextEncoder = TextEncoder
uploadForm.window.DataTransfer = class { files = []; items = { add: file => this.files.push(file) } }
const uploadSchema = uploadForm.window.document.createElement('script')
uploadSchema.textContent = `var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify([null, [null, [[1, 'Resume', null, 13, [[123, null, 1]]]]]])};`
uploadForm.window.document.body.append(uploadSchema)
let uploadListener
uploadForm.window.chrome = { storage, runtime: { id: 'package-test', onMessage: { addListener(callback) { uploadListener = callback } } } }
let uploadedFile
let uploadSubmits = 0
uploadForm.window.document.querySelector('[jsname=M2UYVd]').addEventListener('click', () => uploadSubmits++)
uploadForm.window.document.querySelector('[role=listitem] button').addEventListener('click', () => {
  const frame = uploadForm.window.document.createElement('iframe')
  frame.src = 'https://docs.google.com/picker?hostId=file-upload&selectableMimeTypes=application%2Fpdf'
  uploadForm.window.document.body.append(frame)
  const picker = frame.contentDocument
  picker.open()
  picker.write('<html><body><input type="file" accept="application/pdf"></body></html>')
  picker.close()
  const input = picker.querySelector('input')
  let files = []
  Object.defineProperty(input, 'files', { get: () => files, set: value => { files = [...value] } })
  input.addEventListener('change', () => {
    uploadedFile = files[0]
    uploadForm.window.document.querySelector('[name="entry.123"]').value = '["uploaded-drive-id"]'
    uploadForm.window.document.querySelector('[role=listitem]').append(uploadedFile.name)
    frame.hidden = true
  })
})
uploadForm.window.eval(await readFile('dist/content.js', 'utf8'))
const uploadRequest = message => new Promise(resolve => uploadListener(message, { id: 'package-test' }, resolve))
const downloadsBeforeAutomaticUpload = downloadedFiles.length
await uploadRequest({ type: 'START', settings: stored.settings })
await until(async () => (await uploadRequest({ type: 'SCAN', settings: stored.settings })).scan.automation.status === 'complete', 'Default Run must generate and upload without a separate download action')
assert.equal(uploadedFile.type, 'application/pdf')
assert.equal(downloadedFiles.length, downloadsBeforeAutomaticUpload)
assert.equal(uploadSubmits, 0)
assert.equal((await uploadRequest({ type: 'SCAN', settings: stored.settings })).scan.temporaryCount, 1)
uploadForm.window.close()
console.log('Packaged extension passed: automatic generation/upload by default, fill/clear, navigation, optional download fallback, and no submission.')
