import test from 'node:test'
import assert from 'node:assert/strict'
import { dateParts, placeholder, profileKey } from '../src/shared/profile.ts'
import { DEFAULT_SETTINGS, normalizeSettings } from '../src/shared/types.ts'

const settings = { ...DEFAULT_SETTINGS, name: 'Alex Jordan Rivera', birthday: '1998-03-07', email: 'alex@gmail.com', age: '28' }

test('recognizes common profile questions without confusing unrelated names or words', () => {
  for (const title of ['Full name *', 'Your name', 'Complete Name (Last, First)', 'First name', 'Name of applicant']) assert.equal(profileKey(title), 'name', title)
  for (const title of ['Birthday', 'Birth date', 'Date of birth', 'DOB']) assert.equal(profileKey(title), 'birthday', title)
  for (const title of ['Gmail', 'Email address', 'Your e-mail']) assert.equal(profileKey(title), 'email', title)
  for (const title of ['Age', 'Age (in years)', 'How old are you?']) assert.equal(profileKey(title), 'age', title)
  for (const title of ['Company name', 'Full name of your school', 'School name', 'Username', 'Message', 'Page', 'Tell us about yourself', 'Name of your project']) assert.equal(profileKey(title), null, title)
})

test('uses profile values, separates first/last names, and defaults unrelated text to a dot', () => {
  assert.equal(placeholder('First name', 'text', settings), 'Alex')
  assert.equal(placeholder('Last name', 'text', settings), 'Rivera')
  assert.equal(placeholder('Middle name', 'text', settings), 'Jordan')
  assert.equal(placeholder('Full name', 'text', settings), settings.name)
  assert.equal(placeholder('Name (Last Name, First Name)', 'text', settings), settings.name)
  assert.equal(placeholder('Age', 'text', settings), settings.age)
  assert.equal(placeholder('Gmail', 'text', settings), settings.email)
  assert.equal(placeholder('Birthday', 'date', settings), '1998-03-07')
  assert.equal(placeholder('Birthday (MM/DD/YYYY)', 'text', settings), '03/07/1998')
  assert.equal(placeholder('Birthday (DD/MM/YYYY)', 'text', settings), '07/03/1998')
  assert.equal(placeholder('Why do you want to join?', 'paragraph', settings), '.')
  assert.equal(placeholder('School name', 'text', settings), '.')
  assert.equal(placeholder('Quantity', 'number', settings), '1')
})

test('validates birthday parts and migrates old preferences to the profile defaults', () => {
  assert.deepEqual(dateParts('2000-02-29'), { year: '2000', month: '2', day: '29' })
  for (const invalid of ['2001-02-29', '2000-13-01', '', '01/01/2000']) assert.equal(dateParts(invalid), null)
  const migrated = normalizeSettings({ text: 'Old placeholder', email: 'old@example.com' })
  assert.equal(migrated.name, DEFAULT_SETTINGS.name)
  assert.equal(migrated.email, 'old@example.com')
  assert.equal(placeholder('Summary', 'text', migrated), '.')
})
