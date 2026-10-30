import type { AutomationStatus, Settings } from '../shared/types.ts'
import { DEFAULT_SETTINGS } from '../shared/types.ts'
import type { FormEngine } from './engine.ts'
import { pickerFrames } from './uploads.ts'

interface Run extends AutomationStatus {
  fingerprintVersion: 2
  visited: string[]
  waitingFrom: string
  waitingSince: number
  updatedAt: number
}
const fresh = (): Run => ({ status: 'idle', pages: 0, message: '', fingerprintVersion: 2, visited: [], waitingFrom: '', waitingSince: 0, updatedAt: Date.now() })
const MAX_PAGES = 100
const MAX_IDLE_MS = 10 * 60 * 1000

export class FormAutomation {
  private engine: FormEngine
  private doc: Document
  private storage?: Storage
  private key: string
  private state: Run = fresh()
  private settings: Settings = DEFAULT_SETTINGS
  private timer?: number
  private working = false
  private generation = 0

  constructor(engine: FormEngine, doc: Document, href: string, storage?: Storage) {
    this.engine = engine
    this.doc = doc
    this.storage = storage
    this.key = `formpass:run:${new URL(href).pathname.replace(/\/(viewform|formResponse)\/?$/, '')}`
    try {
      const value = JSON.parse(storage?.getItem(this.key) || 'null') as Partial<Run> | null
      if (value && ['running', 'paused', 'complete'].includes(value.status || '') && Array.isArray(value.visited) && value.visited.every(item => typeof item === 'string') && typeof value.pages === 'number' && typeof value.updatedAt === 'number') {
        this.state = { ...fresh(), ...value, visited: value.visited.slice(0, MAX_PAGES) } as Run
        if (value.fingerprintVersion !== 2) {
          this.state.fingerprintVersion = 2
          this.state.visited = []
          this.state.waitingFrom = ''
          this.state.pages = 0
        }
      }
    } catch { /* Manual filling remains available when site storage is blocked. */ }
  }

  status(): AutomationStatus {
    const { status, pages, message } = this.state
    return { status, pages, message }
  }

  private publish(): boolean {
    this.state.updatedAt = Date.now()
    this.engine.setAutomation(this.status(), () => this.stop())
    try {
      if (!this.storage) return false
      this.storage.setItem(this.key, JSON.stringify(this.state))
      return true
    } catch { return false }
  }

  private schedule() {
    if (this.timer !== undefined) this.doc.defaultView?.clearTimeout(this.timer)
    if (this.state.status === 'running') this.timer = this.doc.defaultView?.setTimeout(() => { this.timer = undefined; void this.step() }, 350)
  }

  private pause(message: string) {
    this.generation++
    if (this.timer !== undefined) this.doc.defaultView?.clearTimeout(this.timer)
    this.timer = undefined
    this.state.status = 'paused'
    this.state.message = message
    this.state.waitingFrom = ''
    this.publish()
  }

  start(settings: Settings): AutomationStatus {
    if (this.state.status === 'running') return this.status()
    if (pickerFrames(this.doc).length) { this.pause('Finish or close the open Google upload window, then Continue.'); return this.status() }
    // Continue is a new traversal from the user's current section. Keeping the
    // previous history traps a paused run when the user goes Back or fixes a branch.
    this.state = fresh()
    this.settings = settings
    this.generation++
    this.state.status = 'running'
    this.state.waitingFrom = ''
    this.state.message = 'Filling this section…'
    if (!this.publish()) this.pause('Automatic navigation needs tab storage. You can still fill this page.')
    else this.schedule()
    return this.status()
  }

  resume(settings: Settings) {
    if (this.state.status !== 'running') return
    if (Date.now() - this.state.updatedAt > MAX_IDLE_MS) { this.pause('Run expired. Start again when you’re ready.'); return }
    this.settings = settings
    this.engine.setAutomation(this.status(), () => this.stop())
    this.schedule()
  }

  stop(): AutomationStatus {
    this.pause('Stopped. Continue when you’re ready.')
    return this.status()
  }

  async step() {
    if (this.state.status !== 'running') return
    if (this.working) { this.schedule(); return }
    this.working = true
    const generation = this.generation
    const active = () => this.state.status === 'running' && generation === this.generation
    try {
      const scan = this.engine.scan(this.settings)
      if (!scan.isGoogleForm) { this.pause('Open the form and finish signing in, then continue.'); return }
      const fingerprint = this.engine.pageFingerprint()
      if (this.state.waitingFrom) {
        if (fingerprint === this.state.waitingFrom) {
          const problem = this.engine.validationProblem()
          if (problem) { this.pause(`Needs your attention: ${problem}. Fix it in the form, then Continue.`); return }
          if (Date.now() - this.state.waitingSince > 8000) {
            const manual = scan.fields.filter(field => field.required && field.status === 'manual').map(field => field.title).slice(0, 2).join(', ')
            this.pause(manual ? `Complete ${manual} in the form, then Continue. Add missing temporary files in FormPass or upload directly in the form.` : 'The form did not advance. Check its validation messages, then Continue.')
            return
          }
          this.schedule()
          return
        }
        this.state.visited.push(this.state.waitingFrom)
        this.state.waitingFrom = ''
      }
      if (this.state.visited.includes(fingerprint)) {
        this.pause('The form returned to a repeated section in this run. Change the branching answer, then Continue to start a fresh pass from here.')
        return
      }
      if (this.state.visited.length >= MAX_PAGES) {
        this.pause(`Reached the ${MAX_PAGES}-section navigation limit. Continue to start a fresh pass from this section.`)
        return
      }
      this.state.pages = this.state.visited.length + 1
      this.state.message = `Filling section ${this.state.pages}…`
      if (!this.publish()) { this.pause('Tab storage is unavailable. Automatic navigation stopped.'); return }
      await this.engine.fill(this.settings, scan.fields.filter(field => field.status === 'ready').map(field => ({ id: field.id, value: field.value })), active, message => {
        if (active()) { this.state.message = message; this.publish() }
      })
      if (!active()) return
      const upload = this.engine.requiredManualUpload()
      if (upload) { this.pause(`File needed: ${upload}. Choose a compatible temporary file in FormPass, or upload it directly in the form, then Continue.`); return }
      // Let Google's own change handlers settle before deciding whether to advance.
      await new Promise(resolve => this.doc.defaultView?.setTimeout(resolve, 120))
      if (!active()) return
      if (fingerprint !== this.engine.pageFingerprint()) { this.schedule(); return }
      const after = this.engine.scan(this.settings)
      const missing = after.fields.find(field => field.required && field.status === 'ready')
      const problem = this.engine.validationProblem()
      if (missing || problem) { this.pause(`Needs your attention: ${problem || missing!.title}. Update the placeholder or fix the answer, then Continue.`); return }
      const { next, final } = this.engine.navigation()
      if (!next) {
        if (final) {
          this.state.status = 'complete'
          const manual = after.fields.filter(field => field.required && field.status === 'manual').length
          this.state.message = `Reached the final section (${this.state.pages} visited).${manual ? ` Review ${manual} manual question(s).` : ''} Nothing was submitted.`
          this.publish()
        } else this.pause('Could not find a Next button. Check the form, then Continue.')
        return
      }
      this.state.waitingFrom = fingerprint
      this.state.waitingSince = Date.now()
      this.state.message = `Moving past section ${this.state.pages}…`
      // Persist BEFORE clicking: Google may replace the entire document.
      if (!this.publish()) { this.pause('Could not save progress. Automatic navigation stopped.'); return }
      if (active() && next.isConnected) next.click()
      this.schedule()
    } catch (error) {
      if (active()) this.pause(error instanceof Error ? error.message : 'Could not continue. Check the form and try again.')
    } finally { this.working = false }
  }
}
