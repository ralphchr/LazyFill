import { FormEngine } from './engine.ts'
import { FormAutomation } from './automation.ts'
import { normalizeSettings } from '../shared/types.ts'
import type { Request, Response } from '../shared/types.ts'

let storage: Storage | undefined
try { storage = window.sessionStorage } catch { /* Some browsers block site storage. */ }
const engine = new FormEngine(document, location.href, storage)
engine.installGuards()
const automation = new FormAutomation(engine, document, location.href, storage)
const scan = (settings?: Parameters<FormEngine['scan']>[0]) => ({ ...engine.scan(settings), automation: automation.status() })
let busy = false

chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse: (response: Response) => void) => {
  if (sender.id !== chrome.runtime.id || !message || !['SCAN', 'FILL', 'CLEAR', 'START', 'STOP'].includes(message.type)) return
  if (message.type === 'STOP') { automation.stop(); sendResponse({ ok: true, scan: scan() }); return }
  if (message.type === 'SCAN') { sendResponse({ ok: true, scan: scan(normalizeSettings(message.settings)) }); return }
  if (automation.status().status === 'running') { sendResponse({ ok: false, message: 'Stop the current run before changing answers.' }); return }
  if (busy) { sendResponse({ ok: false, message: 'A Lazy Fill action is still running. Try again in a moment.' }); return }
  busy = true
  void (async () => {
    try {
      if (message.type === 'START') {
        automation.start(normalizeSettings(message.settings))
        sendResponse({ ok: true, scan: scan(normalizeSettings(message.settings)) })
      }
      else {
        const result = message.type === 'CLEAR' ? await engine.clear() : await engine.fill(normalizeSettings(message.settings), message.values)
        sendResponse({ ok: true, message: result, scan: scan() })
      }
    } catch (error) {
      sendResponse({ ok: false, message: error instanceof Error ? error.message : 'Could not complete the action. Refresh the form and try again.' })
    } finally { busy = false }
  })()
  return true
})

// The popup can close and Google can reload the page; the tab owns the run.
if (automation.status().status === 'running') {
  void chrome.storage.local.get('settings').then(stored => automation.resume(normalizeSettings(stored.settings))).catch(() => automation.stop())
}
