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

export function pickerFrames(doc: Document): HTMLIFrameElement[] {
  return [...doc.querySelectorAll<HTMLIFrameElement>('iframe[src]')].filter(frame => {
    try {
      const url = new URL(frame.src, doc.URL)
      return url.origin === 'https://docs.google.com' && /^\/picker\/?$/.test(url.pathname) && url.searchParams.get('hostId') === 'file-upload' && visible(frame)
    } catch { return false }
  })
}

function currentDocument(frame: HTMLIFrameElement): Document | undefined {
  try { return frame.contentDocument || undefined } catch { return undefined }
}

export function pickerDocuments(doc: Document): Document[] {
  return pickerFrames(doc).flatMap(frame => { const document = currentDocument(frame); return document ? [document] : [] })
}

function nestedDocuments(doc: Document, depth = 0): Document[] {
  if (depth > 3) return []
  const documents = [doc]
  for (const frame of doc.querySelectorAll<HTMLIFrameElement>('iframe')) {
    const nested = currentDocument(frame)
    if (nested) documents.push(...nestedDocuments(nested, depth + 1))
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
  controlsTimeoutMs?: number
  pollMs?: number
}
export interface UploadResult { ok: boolean; cancelled?: boolean; message?: string }

export async function uploadThroughPicker(options: UploadOptions): Promise<UploadResult> {
  const { doc, question, button, files, loadFile, entryIds = [], prepared, progress } = options
  const active = options.active || (() => true)
  const pause = () => new Promise(resolve => doc.defaultView!.setTimeout(resolve, options.pollMs ?? 150))
  if (!active()) return { ok: false, cancelled: true }
  if (pickerFrames(doc).length) return { ok: false, message: 'Close the open Google upload window, then Continue so Lazy Fill can open the correct question’s picker.' }
  const before = googleUploadValue(question, entryIds)
  if (before !== '[]') return { ok: true }
  if (!files.length) return { ok: false, message: 'Choose a temporary file in Lazy Fill, or upload directly in the form, then Continue.' }
  const started = Date.now()
  let message = ''
  const report = (next: string) => { if (message !== next) { message = next; progress?.(next) } }
  report('Opening Google’s upload window…')
  button.click()
  let frame: HTMLIFrameElement | undefined
  while (active() && Date.now() - started < Math.min(options.timeoutMs ?? 45000, 6000)) {
    frame = pickerFrames(doc)[0]
    if (frame) break
    await pause()
  }
  if (!active()) return { ok: false, cancelled: true }
  if (!frame) return { ok: false, message: 'Google’s upload window did not become available. Use Add file in the form, attach your file, then Continue.' }
  report('Waiting for Google’s upload controls…')
  const controlsStarted = Date.now()
  let sent = false
  let file: File | null = null
  let loadedId = ''
  let confirmed = false
  const requestedTabs = new WeakSet<HTMLElement>()
  while (active() && Date.now() - started < (options.timeoutMs ?? 45000)) {
    // Success means the form received an attachment, not merely that a FileList changed.
    const openFrames = pickerFrames(doc)
    if (sent && file && questionShowsFile(question, file.name) && googleUploadValue(question, entryIds) !== before && !openFrames.length) return { ok: true }
    if (!openFrames.includes(frame)) {
      if (!sent) return { ok: false, message: 'The upload window closed before the file was sent. Continue to try again.' }
      // Google may close the dialog before rendering the resulting attachment.
      // Wait for confirmation without reopening or sending the file again.
      await pause(); continue
    }
    if (!sent && Date.now() - controlsStarted > (options.controlsTimeoutMs ?? 12000)) return { ok: false, message: 'Google’s upload window opened, but its file controls are not accessible to Lazy Fill. Use Browse to attach your file in that window, then Continue. Automation remains paused until the form has an attachment.' }
    // Google replaces the initial empty document during loading or tab changes.
    // Read the frame's current document on every poll instead of keeping the old one.
    const picker = currentDocument(frame)
    if (!picker?.body) { await pause(); continue }
    const documents = nestedDocuments(picker)
    const alert = documents.flatMap(document => [...document.querySelectorAll('[role="alert"], [role="alertdialog"], [aria-live="assertive"]')]).find(element => visible(element) && /\b(?:failed|error|cannot upload|can.t upload|unsupported|not supported|too large|empty file|file (?:is )?empty|zero.byte)\b/i.test(text(element)))
    if (alert) return { ok: false, message: `Google could not upload your file: ${text(alert).slice(0, 220)}` }
    if (!sent) {
      const uploadTab = documents.flatMap(document => [...document.querySelectorAll<HTMLElement>('[role="tab"]')]).find(tab => /^upload$/i.test(text(tab)))
      if (uploadTab && uploadTab.getAttribute('aria-selected') !== 'true') {
        if (!requestedTabs.has(uploadTab)) { requestedTabs.add(uploadTab); uploadTab.click() }
        await pause(); continue
      }
      const input = documents.flatMap(document => [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')]).find(enabled)
      if (input?.files?.length) return { ok: false, message: 'A file is already selected in Google’s picker. Finish or cancel that upload, then Continue.' }
      const browse = documents.map(document => document.getElementById('uploadButtonId')).find(element => element && visible(element))
      const dropTarget = browse?.closest<HTMLElement>('[role="group"]') || browse?.parentElement
      if (!input && !dropTarget) { await pause(); continue }
      const limits = new URL(frame.src, doc.URL).searchParams
      const accept = limits.get('selectableMimeTypes') || ''
      const maxSize = Number(limits.get('maxSizeBytesPerItem'))
      const compatible = files.filter(file => acceptsFile(file, accept) && (!input?.accept || acceptsFile(file, input.accept)))
      if (!compatible.length) return { ok: false, message: `This question needs ${accept || input?.accept || 'a different file type'}. Close the picker, choose a compatible temporary file in Lazy Fill, then Continue.` }
      const metadata = compatible.find(file => !(maxSize > 0) || file.size <= maxSize)
      if (!metadata) return { ok: false, message: 'Your file exceeds this question’s file-size limit. Choose a smaller file before continuing.' }
      const Drag = dropTarget?.ownerDocument.defaultView?.DragEvent
      if (!input && !Drag) return { ok: false, message: 'This picker cannot accept an automatic drop. Upload your file directly in the form, then Continue.' }
      if (!file || loadedId !== metadata.id) { report(`Preparing ${metadata.name} from your temporary files…`); file = await loadFile(metadata); loadedId = metadata.id }
      if (!active()) return { ok: false, cancelled: true }
      if (!pickerFrames(doc).includes(frame)) return { ok: false, message: 'The upload window closed before transfer. Continue to try again.' }
      if (currentDocument(frame) !== picker || !(input || dropTarget)!.isConnected) { report('Waiting for Google’s upload controls…'); continue }
      if (input?.files?.length) return { ok: false, message: 'A file was selected while preparing the upload. Finish it in the picker, then Continue.' }
      const transfer = new DataTransfer()
      transfer.items.add(file)
      transfer.effectAllowed = 'copy'
      transfer.dropEffect = 'copy'
      prepared?.(file)
      report(`Passing ${file.name} to Google’s upload controls…`)
      if (input) {
        input.files = transfer.files
        const EventType = input.ownerDocument.defaultView!.Event
        input.dispatchEvent(new EventType('input', { bubbles: true }))
        input.dispatchEvent(new EventType('change', { bubbles: true }))
      } else {
        for (const type of ['dragenter', 'dragover', 'drop']) dropTarget!.dispatchEvent(new Drag!(type, { bubbles: true, cancelable: true, dataTransfer: transfer }))
      }
      sent = true
      report(`Waiting for Google to confirm the attachment: ${file.name}…`)
    } else if (!confirmed && file && (picker.body?.textContent || '').includes(file.name)) {
      const select = documents.flatMap(document => [...document.querySelectorAll<HTMLElement>('button, [role="button"]')]).find(control => enabled(control) && visible(control) && /^(select|insert|upload)$/i.test(text(control)))
      if (select) { confirmed = true; select.click() }
    }
    await pause()
  }
  if (!active()) return { ok: false, cancelled: true }
  return { ok: false, message: sent ? 'Google has not confirmed the upload yet. Finish or cancel it in the picker before continuing; Lazy Fill will not attach a duplicate.' : 'Google’s upload controls were not available. Upload your file directly in the form, then Continue.' }
}
