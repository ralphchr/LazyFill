import test from 'node:test'
import assert from 'node:assert/strict'
import { extractPublicData, parseOutline } from '../src/content-script/outline.ts'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/types.ts'

test('extracts only balanced JSON and ignores trailing JavaScript', () => {
  const data = [null, [null, [[1, 'A "]" and \\" quote', null, 0, [[10, null, 1]]]]]]
  assert.deepEqual(extractPublicData(`var FB_PUBLIC_LOAD_DATA_ = ${JSON.stringify(data)}; window.untrusted();`), data)
  assert.equal(extractPublicData('var FB_PUBLIC_LOAD_DATA_ = [alert("unsafe")];'), null)
  assert.equal(extractPublicData('var FB_PUBLIC_LOAD_DATA_ = ["incomplete"'), null)
  assert.equal(extractPublicData('var something_else = [];'), null)
})

test('outlines later sections, uploads, required answers and grid rows', () => {
  const data = [null, [null, [
    [1, 'Name', null, 0, [[11, null, 1]]],
    [2, 'Documents', 'Prepare these later', 8],
    [3, 'Resume', 'PDF only', 13, [[12, null, 1]]],
    [4, 'Availability', null, 7, [[13, [['Yes'], ['No']], 1, ['Monday']], [14, [['Yes'], ['No']], 0, ['Tuesday']]]],
    [5, 'Decoration', null, 11],
  ]]]
  const sections = parseOutline(data)
  assert.equal(sections.length, 2)
  assert.equal(sections[0].questions[0].required, true)
  assert.equal(sections[1].title, 'Documents')
  assert.equal(sections[1].questions[0].type, 'File upload')
  assert.deepEqual(sections[1].questions[1].rows, ['Monday', 'Tuesday'])
  assert.deepEqual(sections[1].questions[1].options, ['Yes', 'No'])
  assert.deepEqual(parseOutline({ malformed: true }), [])
})

test('settings use safe defaults and validate persisted types', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS)
  assert.equal(normalizeSettings({ includeOptional: 'true', text: 123 }).includeOptional, false)
  assert.equal(normalizeSettings({ text: 'x'.repeat(2000) }).text.length, 1000)
})
