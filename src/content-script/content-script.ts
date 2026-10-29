import { FormEngine } from './engine.ts'
import { normalizeSettings } from '../shared/types.ts'
import type { Request, Response } from '../shared/types.ts'

let storage: Storage | undefined
try { storage = window.sessionStorage } catch { /* Some browsers block site storage. */ }
const engine = new FormEngine(document, location.href, storage)
engine.installGuards()
let busy = false

chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse: (response: Response) => void) => {
  if (sender.id !== chrome.runtime.id || !message || !['SCAN', 'FILL', 'CLEAR'].includes(message.type)) return
  if (busy) { sendResponse({ ok: false, message: 'A FormPass action is still running. Try again in a moment.' }); return }
  busy = true
  void (async () => {
    try {
      if (message.type === 'SCAN') sendResponse({ ok: true, scan: engine.scan(normalizeSettings(message.settings)) })
      else {
        const result = message.type === 'CLEAR' ? await engine.clear() : await engine.fill(normalizeSettings(message.settings), message.values)
        sendResponse({ ok: true, message: result, scan: engine.scan() })
      }
    } catch (error) {
      sendResponse({ ok: false, message: error instanceof Error ? error.message : 'Could not complete the action. Refresh the form and try again.' })
    } finally { busy = false }
  })()
  return true
})
