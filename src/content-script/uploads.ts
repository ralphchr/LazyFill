import { acceptsFile } from '../shared/files.ts'
import type { TemporaryFile } from '../shared/types.ts'

const text = (element: Element) => (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim()
const enabled = (element: Element) => !element.matches(':disabled, [aria-disabled="true"]')

function captions(question: HTMLElement): string {
  return [question.textContent || '', ...[...question.querySelectorAll('[aria-label], [title]')].map(element => `${element.getAttribute('aria-label') || ''} ${element.getAttribute('title') || ''}`)].join(' ')
}

export function questionShowsFile(question: HTMLElement, name: string): boolean {
  return captions(question).includes(name)
}

function visible(element: Element): boolean {
  const win = element.ownerDocument.defaultView
  for (let node: Element | null = element; node; node = node.parentElement) {
    const style = win?.getComputedStyle(node)
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true' || style?.display === 'none' || style?.visibility === 'hidden') return false
  }
  return true
}

export function googleUploadValue(question: HTMLElement, entryIds: string[] = []): string {
  const doc = question.ownerDocument
  const inputs = new Set([...question.querySelectorAll<HTMLInputElement>('input[type="hidden"][name]'), ...doc.querySelectorAll<HTMLInputElement>('input[type="hidden"][name]')].filter(input => question.contains(input) || entryIds.some(id => input.name === `entry.${id}`)))
  const values = [...inputs].filter(input => /^entry\./.test(input.name) && !['', '[]', 'null', '0', '[""]'].includes(input.value.trim())).map(input => `${input.name}:${input.value}`).sort()
  const names = [...question.querySelectorAll('[data-file-name], a[download]')].map(element => element.getAttribute('data-file-name') || element.getAttribute('download') || '').filter(Boolean).sort()
  const remove = [...question.querySelectorAll('button, [role="button"]')].filter(button => /^remove(?:\b|$)/i.test(text(button))).length
  // A Drive link in the question's instructions can be a template, not an upload.
  const links = values.length || names.length || remove ? [...question.querySelectorAll<HTMLAnchorElement>('a[href*="/file/d/"], a[href*="open?id="]')].map(link => link.href).sort() : []
  return values.length || links.length || names.length || remove ? JSON.stringify({ values, links, names, remove }) : '[]'
}

export function pickerDocuments(doc: Document): Document[] {
  const found: Document[] = []
  for (const frame of doc.querySelectorAll<HTMLIFrameElement>('iframe[src]')) {
    try {
      const url = new URL(frame.src, doc.URL)
      if (url.origin !== 'https://docs.google.com' || !/^\/picker\/?$/.test(url.pathname) || url.searchParams.get('hostId') !== 'file-upload' || !visible(frame)) continue
      if (frame.contentDocument) found.push(frame.contentDocument)
    } catch { /* Cross-origin frames are left alone. */ }
  }
  return found
}

function nestedDocuments(doc: Document, depth = 0): Document[] {
  if (depth > 3) return []
  const documents = [doc]
  for (const frame of doc.querySelectorAll<HTMLIFrameElement>('iframe')) {
    try { if (frame.contentDocument) documents.push(...nestedDocuments(frame.contentDocument, depth + 1)) } catch { /* Leave inaccessible frames alone. */ }
  }
  return documents
}

interface UploadOptions {
  doc: Document
  question: HTMLElement
  button: HTMLElement
  files: TemporaryFile[]
  loadFile: (file: TemporaryFile) => Promise<File>
  entryIds?: string[]
  active?: () => boolean
  prepared?: (file: File) => void
  progress?: (message: string) => void
  timeoutMs?: number
  pollMs?: number
}
export interface UploadResult { ok: boolean; cancelled?: boolean; message?: string }

export async function uploadThroughPicker(options: UploadOptions): Promise<UploadResult> {
  const { doc, question, button, files, loadFile, entryIds = [], prepared, progress } = options
  const active = options.active || (() => true)
  const pause = () => new Promise(resolve => doc.defaultView!.setTimeout(resolve, options.pollMs ?? 150))
  if (!active()) return { ok: false, cancelled: true }
  if (pickerDocuments(doc).length) return { ok: false, message: 'Close the open Google upload window, then Continue so FormPass can open the correct question’s picker.' }
  const before = googleUploadValue(question, entryIds)
  if (before !== '[]') return { ok: true }
  if (!files.length) return { ok: false, message: 'Choose a temporary file in FormPass, or upload directly in the form, then Continue.' }
  progress?.('Opening Google’s upload picker…')
  button.click()
  const started = Date.now()
  let picker: Document | undefined
  while (active() && Date.now() - started < Math.min(options.timeoutMs ?? 45000, 6000)) {
    picker = pickerDocuments(doc)[0]
    if (picker?.body) break
    await pause()
  }
  if (!active()) return { ok: false, cancelled: true }
  if (!picker) return { ok: false, message: 'Could not access Google’s upload window. Upload your file directly in the form, then Continue.' }
  const frame = picker.defaultView?.frameElement as HTMLIFrameElement | null
  const limits = frame ? new URL(frame.src, doc.URL).searchParams : new URLSearchParams()
  const accept = limits.get('selectableMimeTypes') || ''
  let sent = false
  let file: File | null = null
  let confirmed = false
  while (active() && Date.now() - started < (options.timeoutMs ?? 45000)) {
    // Success means the form received an attachment, not merely that a FileList changed.
    if (sent && file && questionShowsFile(question, file.name) && googleUploadValue(question, entryIds) !== before && !pickerDocuments(doc).length) return { ok: true }
    const documents = nestedDocuments(picker)
    const alert = documents.flatMap(document => [...document.querySelectorAll('[role="alert"], [role="alertdialog"], [aria-live="assertive"]')]).find(element => visible(element) && /\b(?:failed|error|cannot upload|can.t upload|unsupported|not supported|too large|empty file|file (?:is )?empty|zero.byte)\b/i.test(text(element)))
    if (alert) return { ok: false, message: `Google could not upload your file: ${text(alert).slice(0, 220)}` }
    if (!sent) {
      const uploadTab = [...picker.querySelectorAll<HTMLElement>('[role="tab"]')].find(tab => /^upload$/i.test(text(tab)))
      if (uploadTab && uploadTab.getAttribute('aria-selected') !== 'true') uploadTab.click()
      const input = documents.flatMap(document => [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')]).find(enabled)
      if (input?.files?.length) return { ok: false, message: 'A file is already selected in Google’s picker. Finish or cancel that upload, then Continue.' }
      const maxSize = Number(limits.get('maxSizeBytesPerItem'))
      const compatible = files.filter(file => acceptsFile(file, accept) && (!input?.accept || acceptsFile(file, input.accept)))
      if (!compatible.length) return { ok: false, message: `This question needs ${accept || input?.accept || 'a different file type'}. Close the picker, choose a compatible temporary file in FormPass, then Continue.` }
      const metadata = compatible.find(file => !(maxSize > 0) || file.size <= maxSize)
      if (!metadata) return { ok: false, message: 'Your file exceeds this question’s file-size limit. Choose a smaller file before continuing.' }
      const browse = picker.getElementById('uploadButtonId')
      const dropTarget = browse?.closest<HTMLElement>('[role="group"]') || browse?.parentElement
      if (!input && !dropTarget) { await pause(); continue }
      const Drag = picker.defaultView!.DragEvent
      if (!input && !Drag) return { ok: false, message: 'This picker cannot accept an automatic drop. Upload your file directly in the form, then Continue.' }
      file = await loadFile(metadata)
      if (!active()) return { ok: false, cancelled: true }
      if (!pickerDocuments(doc).includes(picker)) return { ok: false, message: 'The upload window closed before transfer. Continue to try again.' }
      if (input?.files?.length) return { ok: false, message: 'A file was selected while preparing the upload. Finish it in the picker, then Continue.' }
      const transfer = new DataTransfer()
      transfer.items.add(file)
      transfer.effectAllowed = 'copy'
      transfer.dropEffect = 'copy'
      prepared?.(file)
      progress?.(`Uploading ${file.name}…`)
      if (input) {
        input.files = transfer.files
        const EventType = input.ownerDocument.defaultView!.Event
        input.dispatchEvent(new EventType('input', { bubbles: true }))
        input.dispatchEvent(new EventType('change', { bubbles: true }))
      } else {
        for (const type of ['dragenter', 'dragover', 'drop']) dropTarget!.dispatchEvent(new Drag(type, { bubbles: true, cancelable: true, dataTransfer: transfer }))
      }
      sent = true
    } else if (!confirmed && file && (picker.body?.textContent || '').includes(file.name)) {
      const select = [...picker.querySelectorAll<HTMLElement>('button, [role="button"]')].find(control => enabled(control) && visible(control) && /^(select|insert|upload)$/i.test(text(control)))
      if (select) { confirmed = true; select.click() }
    }
    await pause()
  }
  if (!active()) return { ok: false, cancelled: true }
  return { ok: false, message: sent ? 'Google has not confirmed the upload yet. Finish or cancel it in the picker before continuing; FormPass will not attach a duplicate.' : 'Google’s upload controls were not available. Upload your file directly in the form, then Continue.' }
}
