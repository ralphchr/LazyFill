import { DEFAULT_SETTINGS } from '../shared/types.ts'
import type { AutomationStatus, BlankFileType, FieldKind, FieldPreview, ScanResult, Settings } from '../shared/types.ts'
import { dateParts, placeholder, profileKey } from '../shared/profile.ts'
import { makeBlankFile, randomChoice } from '../shared/files.ts'
import { readOutline } from './outline.ts'
import { validatedPlaceholder } from '../shared/validation.ts'
import { googleUploadValue, pickerDocuments, questionShowsFile, uploadThroughPicker } from './uploads.ts'

type TextControl = HTMLInputElement | HTMLTextAreaElement
interface Target {
  preview: FieldPreview
  question: HTMLElement
  element: HTMLElement
  controls: HTMLElement[]
  entryIds?: string[]
}
interface Temporary { id: string; value: string; pending?: boolean; uploadName?: string }

const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
const label = (element: HTMLElement) => clean(element.getAttribute('data-value') || element.getAttribute('aria-label') || element.textContent)
const selected = (element: HTMLElement) => element instanceof HTMLInputElement
  ? element.checked : element.getAttribute('aria-checked') === 'true'
const enabled = (element: HTMLElement) => !element.matches(':disabled, [aria-disabled="true"]')
const collectedEmailSelector = 'form input[type="email"], form input[name="emailAddress"], form input[autocomplete="email"]'

function collectedEmails(doc: Document): HTMLInputElement[] {
  return [...doc.querySelectorAll<HTMLInputElement>(collectedEmailSelector)]
    .filter(element => !element.closest('[role="listitem"]') && !element.matches('[type="hidden"], [type="password"]') && visible(element) && enabled(element))
}

function questions(doc: Document): HTMLElement[] {
  return [...doc.querySelectorAll<HTMLElement>('form [role="listitem"]')]
    .filter(question => visible(question) && !question.parentElement?.closest('[role="listitem"]'))
}

function visible(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

function hash(value: string): string {
  let result = 2166136261
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619)
  return (result >>> 0).toString(36)
}

function setText(element: TextControl, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  element.dispatchEvent(new Event('blur', { bubbles: true }))
}

function choiceLabel(element: HTMLElement): string {
  if (element instanceof HTMLInputElement) return clean(element.labels?.[0]?.textContent || element.value)
  return label(element)
}

function read(target: Target): string {
  const { element, preview, controls } = target
  if (preview.kind === 'file') return element instanceof HTMLInputElement ? JSON.stringify(Array.from(element.files || []).map(file => [file.name, file.size, file.type, file.lastModified])) : googleUploadValue(target.question, target.entryIds)
  if (preview.kind === 'choice' || preview.kind === 'checkbox') return JSON.stringify(controls.filter(selected).map(choiceLabel).sort())
  if (preview.kind === 'dropdown') {
    if (element instanceof HTMLSelectElement) return element.value
    return element.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.getAttribute('data-value') || ''
  }
  return (element as TextControl).value || ''
}

function blank(target: Target): boolean {
  const value = read(target)
  return ['choice', 'checkbox', 'file'].includes(target.preview.kind) ? value === '[]' : value === ''
}

export function isRespondentForm(doc: Document, href: string): boolean {
  const url = new URL(href)
  return url.protocol === 'https:' && url.hostname === 'docs.google.com'
    && /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[^/]+\/(?:viewform|formResponse)\/?$/.test(url.pathname)
    && !!doc.querySelector('form') && (!!doc.querySelector('[role="listitem"]') || collectedEmails(doc).length > 0 || (!!doc.querySelector('[jsname="OCpkoe"], [jsname="M2UYVd"]') && readOutline(doc).length > 0))
}

export class FormEngine {
  private temporary = new Map<string, Temporary>()
  private settings: Settings = DEFAULT_SETTINGS
  private storageKey: string
  private banner: HTMLElement | null = null
  private doc: Document
  private href: string
  private storage?: Storage
  private automation?: AutomationStatus
  private onStop?: () => void

  constructor(doc: Document, href: string, storage?: Storage) {
    this.doc = doc
    this.href = href
    this.storage = storage
    this.storageKey = `formpass:temporary:${new URL(href).pathname.replace(/\/(viewform|formResponse)\/?$/, '')}`
    try {
      const stored: unknown = JSON.parse(storage?.getItem(this.storageKey) || '[]')
      if (Array.isArray(stored)) for (const item of stored) {
        if (item && typeof item.id === 'string' && typeof item.value === 'string') this.temporary.set(item.id, item)
      }
    } catch { /* A blocked storage area must not stop filling. */ }
  }

  private persist() {
    try {
      if (this.temporary.size) this.storage?.setItem(this.storageKey, JSON.stringify([...this.temporary.values()]))
      else this.storage?.removeItem(this.storageKey)
    } catch { /* Continue with in-memory tracking when site storage is unavailable. */ }
    this.updateBanner()
  }

  private targets(settings: Settings): Target[] {
    const sections = readOutline(this.doc)
    const outline = sections.flatMap(section => section.questions)
    const targets: Target[] = []
    // Google's "Collect email addresses" input can live outside the question list.
    for (const [index, element] of collectedEmails(this.doc).entries()) {
      const title = clean(element.labels?.[0]?.textContent || element.getAttribute('aria-label')) || 'Email address'
      const required = element.required || element.getAttribute('aria-required') === 'true' || element.name === 'emailAddress'
      const id = `collected-email:${hash(element.name || element.id || String(index))}`
      const record = this.temporary.get(id)
      if (record && element.value !== record.value) this.temporary.delete(id)
      targets.push({
        element, question: element.parentElement || element, controls: [],
        preview: { id, title, kind: 'email', required, value: settings.email,
          status: element.value ? 'answered' : required || settings.includeOptional ? 'ready' : 'optional' },
      })
    }
    for (const [index, question] of questions(this.doc).entries()) {
      const title = clean(question.querySelector('[role="heading"]')?.textContent).replace(/\s*\*$/, '') || `Question ${index + 1}`
      const metadata = outline.find(item => clean(item.title) === title)
      const required = !!question.querySelector('[aria-required="true"], [required]') || metadata?.required === true || /\*\s*$/.test(clean(question.querySelector('[role="heading"]')?.textContent))
      const identity = question.getAttribute('data-params') || question.getAttribute('data-item-id') || `${title}:${index}`
      const questionId = hash(identity)
      const add = (element: HTMLElement, kind: FieldKind, controls: HTMLElement[] = [], options?: string[], suffix = '', note?: string) => {
        const id = `${questionId}:${suffix || kind}`
        const preview: FieldPreview = { id, title, kind, required, value: '', options, status: 'ready', note }
        const target: Target = { preview, question, element, controls, entryIds: metadata?.entryIds }
        if (kind === 'manual') { preview.status = 'manual'; preview.note ||= 'Complete this question manually.' }
        else if (!blank(target)) preview.status = 'answered'
        else if (!required && !settings.includeOptional) preview.status = 'optional'
        if (options) preview.value = randomChoice(options) || ''
        else if (kind === 'file') preview.value = settings.blankFileType
        else if (kind !== 'manual') preview.value = placeholder(title, kind, settings)
        if (kind !== 'manual') {
          const record = this.temporary.get(id)
          if (record?.pending) {
            const current = read(target)
            if (current !== '[]') {
              if (record.uploadName && !questionShowsFile(question, record.uploadName)) this.temporary.delete(id)
              else { record.pending = false; record.value = current }
            }
          } else if (record && read(target) !== record.value) this.temporary.delete(id)
        }
        targets.push(target)
      }

      if (metadata?.type === 'File upload' || question.querySelector('input[type="file"]') || /\bAdd file\b/i.test(question.textContent || '')) {
        const input = question.querySelector<HTMLInputElement>('input[type="file"]')
        const button = [...question.querySelectorAll<HTMLElement>('button, [role="button"]')].find(button => enabled(button) && visible(button) && (/^add file$/i.test(label(button)) || button.getAttribute('jsname') === 'O5yIud'))
        add(input || button || question, 'file', [], undefined, 'file', 'A blank file will be attached using Google’s upload picker.')
        const target = targets[targets.length - 1]
        const canAttach = settings.attachFiles && typeof DataTransfer !== 'undefined' && (input ? enabled(input) && !!makeBlankFile(settings.blankFileType, input.accept) : !!button)
        if (target.preview.status === 'ready' && !canAttach) {
          target.preview.status = 'manual'
          target.preview.note = 'Click Generate blank file in FormPass, then select the download with Add file → Browse.'
        }
        continue
      }
      const gridRows = [...question.querySelectorAll<HTMLElement>('[role="radiogroup"], [role="row"], [role="group"]')].filter(row => !!row.querySelector('[role="radio"], [role="checkbox"]') && !row.querySelector('[role="radiogroup"], [role="row"], [role="group"]'))
      if ((metadata?.type === 'Grid' || gridRows.length > 1) && gridRows.length) {
        const used = new Set([...question.querySelectorAll<HTMLElement>('[role="radio"], [role="checkbox"]')].filter(selected).map(choiceLabel))
        for (const [rowIndex, row] of gridRows.entries()) {
          const controls = [...row.querySelectorAll<HTMLElement>('[role="radio"], [role="checkbox"]')].filter(control => enabled(control) && visible(control))
          if (!controls.length) continue
          const kind = controls[0].getAttribute('role') === 'checkbox' ? 'checkbox' : 'choice'
          const options = controls.map(choiceLabel).filter(Boolean)
          add(controls[0], kind, controls, options, `row:${rowIndex}`)
          const target = targets[targets.length - 1]
          target.question = row // Never reset an entire grid while clearing one tracked row.
          target.preview.title = `${title} — ${row.getAttribute('aria-label') || metadata?.rows[rowIndex] || `Row ${rowIndex + 1}`}`
          const unused = options.filter(option => !used.has(option))
          target.preview.value = randomChoice(unused.length ? unused : options) || ''
          if (target.preview.status === 'ready') used.add(target.preview.value)
        }
        continue
      }
      if (metadata?.type === 'Grid' || metadata?.type === 'Time') {
        add(question, 'manual', [], undefined, '', 'Use the form to answer this date, time, or grid question.')
        continue
      }
      // "Other" text boxes belong to a choice; filling them can silently select it.
      const hasChoices = !!question.querySelector('[role="radio"], [role="checkbox"], input[type="radio"], input[type="checkbox"]')
      const textControls = hasChoices ? [] : [...question.querySelectorAll<TextControl>('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]), textarea')].filter(element => visible(element) && enabled(element))
      if (textControls.length > 1 && (metadata?.type === 'Date' || profileKey(title) === 'birthday')) {
        const parts = dateParts(settings.birthday)
        const identified = textControls.map(element => {
          const part = clean(`${element.getAttribute('aria-label') || ''} ${element.getAttribute('placeholder') || ''}`).toLowerCase()
          return { element, key: /\byear\b|\byyyy\b/.test(part) ? 'year' : /\bmonth\b|\bmm\b/.test(part) ? 'month' : /\bday\b|\bdd\b/.test(part) ? 'day' : '' }
        })
        if (identified.every(item => item.key) && new Set(identified.map(item => item.key)).size === identified.length) {
          for (const { element, key } of identified) {
            add(element, 'number', [], undefined, `date:${key}`)
            targets[targets.length - 1].preview.value = parts?.[key as 'year' | 'month' | 'day'] || ''
          }
          continue
        }
      }
      if (textControls.length > 1) {
        add(question, 'manual', [], undefined, '', 'This question has multiple input parts. Complete it manually.')
        continue
      }
      for (const [controlIndex, element] of textControls.entries()) {
        const type = element instanceof HTMLTextAreaElement ? 'paragraph' : element.type
        let kind: FieldKind = type === 'paragraph' ? 'paragraph' : type === 'tel' ? 'phone' : type === 'email' || type === 'number' || type === 'url' || type === 'date' ? type : type === 'text' || type === '' ? 'text' : 'manual'
        if (kind === 'text' && (profileKey(title) === 'email' || element.getAttribute('autocomplete') === 'email' || element.getAttribute('name') === 'emailAddress')) kind = 'email'
        else if (kind === 'text' && /^(numeric|decimal)$/.test(element.inputMode)) kind = 'number'
        else if (kind === 'text' && /\b(website|web ?site|url)\b/i.test(title)) kind = 'url'
        const suffix = element.getAttribute('name') || element.getAttribute('aria-label') || String(controlIndex)
        add(element, kind, [], undefined, `input:${suffix}`, element.getAttribute('pattern') ? 'This answer has validation rules; adjust the temporary value if needed.' : undefined)
        if (kind !== 'manual') {
          const described = (element.getAttribute('aria-describedby') || '').split(/\s+/).map(id => this.doc.getElementById(id)?.textContent || '').join(' ')
          targets[targets.length - 1].preview.value = validatedPlaceholder(title, kind, settings, {
            type, inputMode: element.inputMode, pattern: element.getAttribute('pattern') || '',
            minLength: element.minLength, maxLength: element.maxLength,
            description: `${title} ${metadata?.description || ''} ${element.getAttribute('placeholder') || ''} ${element.getAttribute('title') || ''} ${described} ${question.textContent || ''}`,
            numeric: metadata?.validation?.numeric, metadataPattern: metadata?.validation?.pattern,
          })
        }
      }
      for (const [kind, selector] of [['choice', '[role="radio"], input[type="radio"]'], ['checkbox', '[role="checkbox"], input[type="checkbox"]']] as const) {
        const controls = [...question.querySelectorAll<HTMLElement>(selector)].filter(element => visible(element) && enabled(element) && !(element instanceof HTMLInputElement && element.parentElement?.closest('[role="radio"], [role="checkbox"]')))
        if (!controls.length) continue
        const options = controls.filter(control => control.getAttribute('data-value') !== '__other_option__' && !control.querySelector('input[type="text"], textarea')).map(choiceLabel).filter(Boolean)
        add(controls[0], kind, controls, options)
      }
      const dropdown = question.querySelector<HTMLElement>('select, [role="listbox"]')
      if (dropdown && enabled(dropdown) && visible(dropdown)) {
        const options = dropdown instanceof HTMLSelectElement
          ? [...dropdown.options].filter(option => option.value && !option.disabled).map(option => option.text)
          : [...dropdown.querySelectorAll<HTMLElement>('[role="option"][data-value]')].filter(option => enabled(option) && option.getAttribute('data-value')).map(label)
        add(dropdown, 'dropdown', [], options.length ? options : metadata?.options || [])
      }
      if (!targets.some(target => target.question === question)) add(question, 'manual')
    }
    return targets
  }

  scan(settings = this.settings): ScanResult {
    this.settings = settings
    const detected = isRespondentForm(this.doc, this.href)
    const sections = detected ? readOutline(this.doc) : []
    const fields = detected ? this.targets(settings).map(target => target.preview) : []
    this.persist()
    return { isGoogleForm: detected, title: this.doc.title.replace(/\s*[-–]\s*Google Forms$/, ''), fields, sections, outlineAvailable: sections.length > 0, temporaryCount: this.temporary.size }
  }

  private async choose(target: Target, value: string): Promise<boolean> {
    if (target.preview.kind === 'dropdown') {
      const element = target.element
      if (element instanceof HTMLSelectElement) {
        const option = [...element.options].find(option => option.text === value && !option.disabled)
        if (!option) return false
        element.value = option.value
        element.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      }
      element.click()
      for (let attempt = 0; attempt < 10; attempt++) {
        const option = [...element.querySelectorAll<HTMLElement>('[role="option"]')].find(option => enabled(option) && visible(option) && label(option) === value)
        if (option) { option.click(); return true }
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      // Close a menu we opened if Google has changed its markup.
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return false
    }
    const control = target.controls.find(control => choiceLabel(control) === value)
    if (!control) return false
    control.click()
    return selected(control)
  }

  async fill(settings: Settings, values: { id: string; value: string }[], shouldContinue = () => true, progress?: (message: string) => void): Promise<string> {
    if (!isRespondentForm(this.doc, this.href)) throw new Error('Open a Google Form respondent page first.')
    if (pickerDocuments(this.doc).length) throw new Error('Finish or close the open Google upload window, then Continue so FormPass can open the correct question’s picker.')
    this.settings = settings
    const targets = this.targets(settings)
    let filled = 0
    let skipped = 0
    for (const { id, value } of values) {
      if (!shouldContinue()) break
      const target = targets.find(item => item.preview.id === id)
      if (!target || !target.element.isConnected || target.preview.status !== 'ready' || !blank(target) || !value.trim()) { skipped++; continue }
      const before = read(target)
      if (target.preview.kind === 'file') {
        const pending = this.temporary.get(id)
        if (pending?.pending) throw new Error('A previous blank upload is unconfirmed. Finish it, or close the picker and use Clear this page to reset the attempt before continuing.')
        if (!(target.element instanceof HTMLInputElement)) {
          const result = await uploadThroughPicker({ doc: this.doc, question: target.question, button: target.element, kind: settings.blankFileType, entryIds: target.entryIds, active: shouldContinue, progress,
            prepared: file => { this.temporary.set(id, { id, value: before, pending: true, uploadName: file.name }); this.persist() },
          })
          if (result.cancelled) break
          if (!result.ok) throw new Error(result.message || 'Google did not confirm the file upload.')
        } else {
          const input = target.element as HTMLInputElement
          const file = settings.attachFiles && ['random', 'png', 'pdf', 'txt'].includes(value) ? makeBlankFile(value as BlankFileType, input.accept) : null
          if (!file || typeof DataTransfer === 'undefined') { skipped++; continue }
          const transfer = new DataTransfer()
          transfer.items.add(file)
          input.files = transfer.files
          input.dispatchEvent(new Event('input', { bubbles: true }))
          input.dispatchEvent(new Event('change', { bubbles: true }))
        }
      } else if (target.preview.options) {
        if (!target.preview.options.includes(value) || !await this.choose(target, value)) { skipped++; continue }
      } else {
        const element = target.element as TextControl
        setText(element, value)
        if (!element.checkValidity()) { setText(element, before); skipped++; continue }
      }
      const after = read(target)
      if (after === before) { skipped++; continue }
      this.temporary.set(id, { id, value: after, ...(this.temporary.get(id)?.uploadName ? { uploadName: this.temporary.get(id)!.uploadName } : {}) })
      filled++
      this.persist()
    }
    return `${filled} temporary answer${filled === 1 ? '' : 's'} filled.${skipped ? ` ${skipped} skipped; review the form’s validation messages.` : ''}`
  }

  async clear(): Promise<string> {
    if (pickerDocuments(this.doc).length) throw new Error('Finish or close Google’s upload window before clearing temporary answers.')
    const targets = this.targets(this.settings)
    let cleared = 0
    for (const target of targets) {
      const record = this.temporary.get(target.preview.id)
      if (!record || read(target) !== record.value) continue
      if (record.pending) {
        if (!pickerDocuments(this.doc).length && blank(target)) { this.temporary.delete(record.id); cleared++ }
        continue
      }
      const kind = target.preview.kind
      if (kind === 'file' && !(target.element instanceof HTMLInputElement)) {
        if (pickerDocuments(this.doc).length) continue
        const remove = [...target.question.querySelectorAll<HTMLElement>('button, [role="button"]')].find(button => /^remove(?:\b|$)/i.test(label(button)))
        remove?.click()
      } else if (kind === 'checkbox') target.controls.filter(selected).forEach(control => control.click())
      else if (kind === 'choice') {
        const native = target.controls.every(control => control instanceof HTMLInputElement)
        if (native) target.controls.forEach(control => { (control as HTMLInputElement).checked = false; control.dispatchEvent(new Event('change', { bubbles: true })) })
        else {
          const clearButton = [...target.question.querySelectorAll<HTMLElement>('[role="button"], button')].find(button => /clear selection/i.test(label(button)))
          clearButton?.click()
        }
      } else if (kind === 'dropdown') {
        if (target.element instanceof HTMLSelectElement) {
          target.element.value = ''
          target.element.dispatchEvent(new Event('change', { bubbles: true }))
        } else {
          const empty = target.element.querySelector<HTMLElement>('[role="option"][data-value=""]')
          if (empty) { target.element.click(); empty.click() }
        }
      } else if (kind !== 'manual') setText(target.element as TextControl, '')
      if (blank(target)) { this.temporary.delete(record.id); cleared++ }
    }
    this.persist()
    return `${cleared} temporary answer${cleared === 1 ? '' : 's'} cleared.${this.temporary.size ? ' Some remain: visit earlier sections or clear selections manually in the form.' : ''}`
  }

  private updateBanner() {
    if (!this.temporary.size && this.automation?.status !== 'running') { this.banner?.remove(); this.banner = null; return }
    if (!this.banner?.isConnected) {
      this.banner = this.doc.createElement('aside')
      this.banner.id = 'formpass-notice'
      this.banner.setAttribute('role', 'status')
      this.banner.style.cssText = 'position:sticky;top:0;z-index:2147483647;padding:12px 20px;background:#172e29;color:#edfff8;font:14px/1.5 system-ui;text-align:center;box-shadow:0 2px 12px #0002'
      this.doc.body.prepend(this.banner)
    }
    const text = this.doc.createElement('span')
    text.textContent = `FormPass · ${this.automation?.status === 'running' || this.automation?.status === 'paused' ? this.automation.message : `${this.temporary.size} temporary answer(s). Replace or clear before submitting. Google may autosave.`}`
    this.banner.replaceChildren(text)
    if (this.automation?.status === 'running' && this.onStop) {
      const stop = this.doc.createElement('button')
      stop.type = 'button'
      stop.textContent = 'Stop'
      stop.style.cssText = 'margin-left:14px;padding:4px 12px;border:1px solid #b9d1c3;border-radius:5px;background:transparent;color:inherit;cursor:pointer;font:inherit'
      stop.addEventListener('click', this.onStop)
      this.banner.append(stop)
    }
  }

  setAutomation(status: AutomationStatus, onStop: () => void) {
    this.automation = status
    this.onStop = onStop
    this.updateBanner()
  }

  pageFingerprint(): string {
    // Identify visible form content, independent of answer values, picker headings,
    // hidden sections and changing control/validation markup.
    const items = questions(this.doc).map((question, index) => {
      const entries = [...question.querySelectorAll<HTMLElement>('[name^="entry."]')].map(element => element.getAttribute('name')).sort()
      return question.getAttribute('data-item-id') || (entries.length ? entries : question.getAttribute('data-params')) || `${clean(question.querySelector('[role="heading"]')?.textContent)}:${index}`
    })
    const headings = [...this.doc.querySelectorAll<HTMLElement>('form [role="heading"]')]
      .filter(heading => visible(heading) && !heading.closest('[role="listitem"], [role="dialog"], [role="alert"]'))
      .map(heading => clean(heading.textContent))
    return hash(JSON.stringify([items, headings, collectedEmails(this.doc).map(element => element.name || element.id || 'email')]))
  }

  navigation(): { next: HTMLElement | null; final: boolean } {
    const buttons = [...this.doc.querySelectorAll<HTMLElement>('button, [role="button"]')].filter(button => visible(button) && enabled(button))
    const isSubmit = (button: HTMLElement) => button.getAttribute('jsname') === 'M2UYVd' || /^(submit|send)$/i.test(clean(button.textContent))
    const next = buttons.find(button => !isSubmit(button) && (button.getAttribute('jsname') === 'OCpkoe' || (!button.matches('button[type="submit"]') && /^(next|continue|susunod)$/i.test(clean(button.textContent))))) || null
    return { next, final: !next && buttons.some(isSubmit) }
  }

  validationProblem(): string {
    const invalid = [...this.doc.querySelectorAll<HTMLElement>('[aria-invalid="true"], input:invalid, textarea:invalid, select:invalid')].find(element => enabled(element) && visible(element))
    return invalid ? clean(invalid.closest('[role="listitem"]')?.querySelector('[role="heading"]')?.textContent) || 'A required answer' : ''
  }

  requiredManualUpload(): string | undefined {
    return this.targets(this.settings).find(target => target.preview.kind === 'file' && target.preview.status === 'manual' && target.preview.required && enabled(target.element) && blank(target))?.preview.title
  }

  installGuards() {
    const onEdit = (event: Event) => {
      if (!event.isTrusted || !(event.target instanceof HTMLElement)) return
      const element = event.target
      for (const target of this.targets(this.settings)) {
        if (target.element === element || target.controls.some(control => control === element || control.contains(element)) || target.element.contains(element)) this.temporary.delete(target.preview.id)
      }
      this.persist()
    }
    this.doc.addEventListener('input', onEdit, true)
    this.doc.addEventListener('change', onEdit, true)
    this.doc.addEventListener('click', event => {
      if (!(event.target instanceof HTMLElement)) return
      const button = event.target.closest<HTMLElement>('button, [role="button"]')
      if (!button || !(button.getAttribute('jsname') === 'M2UYVd' || /^(submit|send)$/i.test(clean(button.textContent)))) return
      this.scan()
      if (!this.temporary.size) return
      event.preventDefault()
      event.stopImmediatePropagation()
      this.updateBanner()
      this.banner?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    }, true)
    this.doc.addEventListener('submit', event => {
      const buttons = [...this.doc.querySelectorAll<HTMLElement>('button, [role="button"]')].filter(visible)
      const hasNext = buttons.some(button => button.getAttribute('jsname') === 'OCpkoe' || /^next$/i.test(clean(button.textContent)))
      const hasSubmit = buttons.some(button => button.getAttribute('jsname') === 'M2UYVd' || /^(submit|send)$/i.test(clean(button.textContent)))
      this.scan()
      if (!hasNext && hasSubmit && this.temporary.size) {
        event.preventDefault()
        event.stopImmediatePropagation()
        this.updateBanner()
      }
    }, true)
    this.scan()
  }
}
