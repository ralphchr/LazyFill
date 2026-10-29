import { DEFAULT_SETTINGS } from '../shared/types.ts'
import type { FieldKind, FieldPreview, ScanResult, Settings } from '../shared/types.ts'
import { readOutline } from './outline.ts'

type TextControl = HTMLInputElement | HTMLTextAreaElement
interface Target {
  preview: FieldPreview
  question: HTMLElement
  element: HTMLElement
  controls: HTMLElement[]
}
interface Temporary { id: string; value: string }

const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
const label = (element: HTMLElement) => clean(element.getAttribute('data-value') || element.getAttribute('aria-label') || element.textContent)
const selected = (element: HTMLElement) => element instanceof HTMLInputElement
  ? element.checked : element.getAttribute('aria-checked') === 'true'
const enabled = (element: HTMLElement) => !element.matches(':disabled, [aria-disabled="true"]')

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
  if (preview.kind === 'choice' || preview.kind === 'checkbox') return JSON.stringify(controls.filter(selected).map(choiceLabel).sort())
  if (preview.kind === 'dropdown') {
    if (element instanceof HTMLSelectElement) return element.value
    return element.querySelector<HTMLElement>('[role="option"][aria-selected="true"]')?.getAttribute('data-value') || ''
  }
  return (element as TextControl).value || ''
}

function blank(target: Target): boolean {
  const value = read(target)
  return target.preview.kind === 'choice' || target.preview.kind === 'checkbox' ? value === '[]' : value === ''
}

export function isRespondentForm(doc: Document, href: string): boolean {
  const url = new URL(href)
  return url.protocol === 'https:' && url.hostname === 'docs.google.com'
    && /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[^/]+\/(?:viewform|formResponse)\/?$/.test(url.pathname)
    && !!doc.querySelector('form') && !!doc.querySelector('[role="listitem"]')
}

export class FormEngine {
  private temporary = new Map<string, Temporary>()
  private settings: Settings = DEFAULT_SETTINGS
  private storageKey: string
  private banner: HTMLElement | null = null
  private doc: Document
  private href: string
  private storage?: Storage

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
    const questions = [...this.doc.querySelectorAll<HTMLElement>('[role="listitem"]')].filter(question => visible(question) && !question.parentElement?.closest('[role="listitem"]'))
    const targets: Target[] = []
    for (const [index, question] of questions.entries()) {
      const title = clean(question.querySelector('[role="heading"]')?.textContent).replace(/\s*\*$/, '') || `Question ${index + 1}`
      const metadata = outline.find(item => clean(item.title) === title)
      const required = !!question.querySelector('[aria-required="true"], [required]') || metadata?.required === true || /\*\s*$/.test(clean(question.querySelector('[role="heading"]')?.textContent))
      const identity = question.getAttribute('data-params') || question.getAttribute('data-item-id') || `${title}:${index}`
      const questionId = hash(identity)
      const add = (element: HTMLElement, kind: FieldKind, controls: HTMLElement[] = [], options?: string[], suffix = '', note?: string) => {
        const id = `${questionId}:${suffix || kind}`
        const preview: FieldPreview = { id, title, kind, required, value: '', options, status: 'ready', note }
        const target: Target = { preview, question, element, controls }
        if (kind === 'manual') { preview.status = 'manual'; preview.note ||= 'Complete this question manually.' }
        else if (!blank(target)) preview.status = 'answered'
        else if (!required && !settings.includeOptional) preview.status = 'optional'
        if (options) preview.value = options[0] || ''
        else if (kind !== 'manual' && kind !== 'choice' && kind !== 'checkbox' && kind !== 'dropdown') preview.value = settings[kind]
        if (kind !== 'manual') {
          const record = this.temporary.get(id)
          if (record && read(target) !== record.value) this.temporary.delete(id)
        }
        targets.push(target)
      }

      if (metadata?.type === 'File upload' || question.querySelector('input[type="file"]') || /\bAdd file\b/i.test(question.textContent || '')) {
        add(question, 'manual', [], undefined, '', 'File uploads are manual. Use All sections to inspect later questions without uploading.')
        continue
      }
      if (metadata?.type === 'Grid' || question.querySelectorAll('[role="radiogroup"]').length > 1 || metadata?.type === 'Date' || metadata?.type === 'Time') {
        add(question, 'manual', [], undefined, '', 'Use the form to answer this date, time, or grid question.')
        continue
      }
      // "Other" text boxes belong to a choice; filling them can silently select it.
      const hasChoices = !!question.querySelector('[role="radio"], [role="checkbox"], input[type="radio"], input[type="checkbox"]')
      const textControls = hasChoices ? [] : [...question.querySelectorAll<TextControl>('input:not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):not([type="file"]), textarea')].filter(element => visible(element) && enabled(element))
      if (textControls.length > 1) {
        add(question, 'manual', [], undefined, '', 'This question has multiple input parts. Complete it manually.')
        continue
      }
      for (const [controlIndex, element] of textControls.entries()) {
        const type = element instanceof HTMLTextAreaElement ? 'paragraph' : element.type
        let kind: FieldKind = type === 'paragraph' ? 'paragraph' : type === 'email' || type === 'number' || type === 'url' ? type : type === 'text' || type === '' ? 'text' : 'manual'
        if (kind === 'text' && /\be-?mail\b/i.test(title)) kind = 'email'
        else if (kind === 'text' && /^(numeric|decimal)$/.test(element.inputMode)) kind = 'number'
        else if (kind === 'text' && /\b(website|web ?site|url)\b/i.test(title)) kind = 'url'
        const suffix = element.getAttribute('name') || element.getAttribute('aria-label') || String(controlIndex)
        add(element, kind, [], undefined, `input:${suffix}`, element.getAttribute('pattern') ? 'This answer has validation rules; adjust the temporary value if needed.' : undefined)
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

  async fill(settings: Settings, values: { id: string; value: string }[]): Promise<string> {
    if (!isRespondentForm(this.doc, this.href)) throw new Error('Open a Google Form respondent page first.')
    const targets = this.targets(settings)
    let filled = 0
    let skipped = 0
    for (const { id, value } of values) {
      const target = targets.find(item => item.preview.id === id)
      if (!target || !target.element.isConnected || target.preview.status !== 'ready' || !blank(target) || !value.trim()) { skipped++; continue }
      const before = read(target)
      if (target.preview.options) {
        if (!target.preview.options.includes(value) || !await this.choose(target, value)) { skipped++; continue }
      } else {
        const element = target.element as TextControl
        setText(element, value)
        if (!element.checkValidity()) { setText(element, before); skipped++; continue }
      }
      const after = read(target)
      if (after === before) { skipped++; continue }
      this.temporary.set(id, { id, value: after })
      filled++
      this.persist()
    }
    return `${filled} temporary answer${filled === 1 ? '' : 's'} filled.${skipped ? ` ${skipped} skipped; review validation or refresh the scan.` : ''} Use the form’s Next button when ready.`
  }

  async clear(): Promise<string> {
    const targets = this.targets(this.settings)
    let cleared = 0
    for (const target of targets) {
      const record = this.temporary.get(target.preview.id)
      if (!record || read(target) !== record.value) continue
      const kind = target.preview.kind
      if (kind === 'checkbox') target.controls.filter(selected).forEach(control => control.click())
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
    if (!this.temporary.size) { this.banner?.remove(); this.banner = null; return }
    if (!this.banner?.isConnected) {
      this.banner = this.doc.createElement('aside')
      this.banner.id = 'formpass-notice'
      this.banner.setAttribute('role', 'status')
      this.banner.style.cssText = 'position:sticky;top:0;z-index:2147483647;padding:12px 20px;background:#172e29;color:#edfff8;font:14px/1.5 system-ui;text-align:center;box-shadow:0 2px 12px #0002'
      this.doc.body.prepend(this.banner)
    }
    this.banner.textContent = `FormPass · ${this.temporary.size} temporary answer(s). Replace or clear them before submitting. Google may autosave these answers.`
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
