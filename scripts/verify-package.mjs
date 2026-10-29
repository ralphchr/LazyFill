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
form.window.chrome = { runtime: { id: 'package-test', onMessage: { addListener(callback) { listener = callback } } } }
form.window.eval(await readFile('dist/content.js', 'utf8'))
assert.equal(typeof listener, 'function', 'Packaged content script must register messaging')

const html = await readFile('dist/popup.html', 'utf8')
const scriptPath = html.match(/<script[^>]*src="([^"]+)"/)?.[1]
assert.ok(scriptPath, 'Packaged popup must reference its bundle')
const popup = new JSDOM(html, { url: 'https://extension.test/popup.html', runScripts: 'outside-only', pretendToBeVisual: true })
popup.window.chrome = {
  tabs: {
    query: async () => [{ id: 1, url: form.window.location.href }],
    sendMessage: async (_id, message) => new Promise(resolve => listener(message, { id: 'package-test' }, resolve)),
  },
  storage: { local: { get: async () => ({}), set: async () => {} } },
}
popup.window.eval(await readFile(`dist/${scriptPath.replace(/^\.\//, '')}`, 'utf8'))
async function until(predicate, message) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.fail(message)
}
const doc = popup.window.document
await until(() => doc.querySelector('.connected'), 'The packaged popup must detect the form and render')
assert.match(doc.body.textContent, /Application preview/)
assert.equal(doc.querySelectorAll('.field').length, 5)
assert.match(doc.querySelector('.field.answered')?.textContent || '', /Email/)
assert.match(doc.querySelector('.field.manual')?.textContent || '', /Resume/)
doc.querySelector('.primary').click()
await until(() => doc.querySelector('.success')?.textContent.includes('2 temporary answers filled'), 'Popup Fill must reach the packaged content script')
assert.match(form.window.document.querySelector('[name="entry.1"]').value, /TEMPORARY/)
assert.equal(form.window.document.querySelector('input[type=email]').value, 'your.real.answer@example.com')
assert.equal(form.window.document.querySelector('select').value, 'design')
assert.equal(form.window.document.querySelector('textarea').value, '')
assert.ok(form.window.document.querySelector('#formpass-notice'))
doc.querySelectorAll('.tabs button')[1].click()
await until(() => doc.querySelectorAll('.section-card').length === 2, 'All sections must show later pages')
assert.match(doc.querySelector('.outline').textContent, /Project description/)
doc.querySelector('.text-button').click()
await until(() => doc.querySelector('.success')?.textContent.includes('2 temporary answers cleared'), 'Clear must remove inserted values')
assert.equal(form.window.document.querySelector('[name="entry.1"]').value, '')
assert.equal(form.window.document.querySelector('select').value, '')
assert.equal(form.window.document.querySelector('input[type=email]').value, 'your.real.answer@example.com')
assert.equal(form.window.document.querySelector('#formpass-notice'), null)
popup.window.close()
form.window.close()
console.log('Packaged extension smoke test passed: popup → messaging → fill → outline → clear.')
