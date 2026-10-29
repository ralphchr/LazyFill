import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/types.ts'
import type { BlankFileType, Request, Response, ScanResult, Settings } from '../shared/types.ts'
import { makeBlankFile } from '../shared/files.ts'

function Popup() {
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const tabId = useRef<number | null>(null)
  const running = scan?.automation?.status === 'running'
  const connected = scan?.isGoogleForm === true

  function accept(result: Response) {
    if (!result?.ok) throw new Error(result?.message || 'Could not read the form. Reload it and try again.')
    if (result.scan) setScan(result.scan)
    if (result.message) setMessage(result.message)
    return result
  }

  async function send(request: Request) {
    if (tabId.current === null) throw new Error('Open a Google Form, then reopen FormPass.')
    let result: Response
    try { result = await chrome.tabs.sendMessage(tabId.current, request) as Response }
    catch { throw new Error('Reload the form after updating FormPass. If it is moving to another section, try again in a moment.') }
    return accept(result)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (typeof chrome === 'undefined' || !chrome.tabs) throw new Error('Load the dist folder as an extension in Edge or Chrome.')
        const [tabs, stored] = await Promise.all([chrome.tabs.query({ active: true, currentWindow: true }), chrome.storage.local.get('settings')])
        if (cancelled) return
        const next = normalizeSettings(stored.settings)
        setSettings(next)
        const tab = tabs[0]
        if (!tab?.id || !tab.url?.startsWith('https://docs.google.com/forms/')) throw new Error('Open a Google Form respondent link, then click FormPass.')
        tabId.current = tab.id
        const result = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN', settings: next }) as Response
        if (!cancelled) accept(result)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error && !/Receiving end|connection/i.test(cause.message) ? cause.message : 'Reload the Google Form after updating FormPass, then reopen the popup.')
      } finally { if (!cancelled) setBusy(false) }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!running || tabId.current === null) return
    let cancelled = false
    let pending = false
    let failures = 0
    const timer = window.setInterval(() => {
      if (pending) return
      pending = true
      void chrome.tabs.sendMessage(tabId.current!, { type: 'SCAN', settings }).then((result: Response) => {
        if (!cancelled) { accept(result); failures = 0 }
      }).catch(() => {
        if (!cancelled && ++failures >= 25) setError('The form is taking a while to load. Reopen FormPass once it finishes.')
      }).finally(() => { pending = false })
    }, 600)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [running, settings])

  async function act(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    setMessage('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete the action. Try again.') }
    finally { setBusy(false) }
  }

  async function save() {
    // Keep legacy preference keys readable while using the new dot default.
    const next: Settings = { ...settings, text: '.', paragraph: '.', attachFiles: settings.fileMode === 'attach' }
    await chrome.storage.local.set({ settings: next })
    return next
  }

  async function generateFile() {
    const file = makeBlankFile(settings.blankFileType)!
    const url = URL.createObjectURL(file)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.name
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 10000)
    if (typeof chrome !== 'undefined' && chrome.storage) await chrome.storage.local.set({ settings })
    setMessage(`Generated ${file.name}. In the form, choose Add file → Browse and select it from Downloads.`)
  }

  async function stop() {
    // A Next click can briefly disconnect the old document's message listener.
    for (let attempt = 0; attempt < 30; attempt++) {
      try { return await accept(await chrome.tabs.sendMessage(tabId.current!, { type: 'STOP' }) as Response) }
      catch { if (attempt < 29) await new Promise(resolve => window.setTimeout(resolve, 200)) }
    }
    throw new Error('The form is still loading. Use Stop in its banner once the page appears.')
  }

  const disabled = busy || running
  const status = scan?.automation
  const ready = scan?.fields.filter(field => field.status === 'ready').length || 0

  return <main className="popup">
    <header><div className="brand"><span className="mark" aria-hidden="true">F<span>↗</span></span><h1>FormPass</h1></div><span className="version">0.2.3</span></header>
    <div className="form-title"><span className={`dot ${connected ? 'connected' : ''}`} /><p>{connected ? scan.title || 'Untitled form' : 'Google Forms, on your terms'}</p></div>
    <h2>Set once. Fill the rest.</h2>
    <p className="subtitle">Other fields: text <code>.</code> · numbers <code>0</code> · alphanumeric <code>A0</code></p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {message && <p className="notice success" role="status">{message}</p>}
    {status && status.status !== 'idle' && <div className={`run-status ${status.status}`} role="status"><span className="status-dot" /><p>{status.message}</p></div>}
    {busy && !connected && <p className="notice" role="status">Connecting to your form…</p>}

    <form className="profile" onSubmit={event => { event.preventDefault(); void act(async () => { const next = await save(); await send({ type: 'START', settings: next }) }) }}>
      <div className="profile-grid">
        <label>Name<input name="name" autoComplete="off" required disabled={disabled} value={settings.name} onChange={event => setSettings(previous => ({ ...previous, name: event.target.value }))} /></label>
        <label>Contact number<input name="contact" type="tel" autoComplete="off" required disabled={disabled} value={settings.contact} onChange={event => setSettings(previous => ({ ...previous, contact: event.target.value }))} /></label>
        <label className="wide">Gmail / email<input name="email" type="email" autoComplete="off" required disabled={disabled} value={settings.email} onChange={event => setSettings(previous => ({ ...previous, email: event.target.value }))} /></label>
        <label>Birthday<input name="birthday" type="date" required disabled={disabled} value={settings.birthday} onChange={event => setSettings(previous => ({ ...previous, birthday: event.target.value }))} /></label>
        <label>Age<input name="age" type="number" min="0" max="150" required disabled={disabled} value={settings.age} onChange={event => setSettings(previous => ({ ...previous, age: event.target.value }))} /></label>
      </div>
      {running ? <button className="primary stop" type="button" disabled={busy} onClick={() => void act(stop)}>Stop automation <span>■</span></button> : <button className="primary" disabled={busy || !connected}>{status?.status === 'paused' ? 'Continue all sections' : 'Run all sections'} <span>↗</span></button>}
    </form>
    <p className="run-hint">Fills from this page to the end. Stops before Submit.</p>

    <section className="file-generator" aria-label="Temporary upload file">
      <div className="file-download"><select aria-label="Blank file type" disabled={busy} value={settings.blankFileType} onChange={event => setSettings(previous => ({ ...previous, blankFileType: event.target.value as BlankFileType }))}><option value="random">Random file type</option><option value="png">Blank PNG</option><option value="pdf">Blank PDF</option><option value="txt">Empty TXT</option></select><button className="generate-file" type="button" disabled={busy} onClick={() => void act(generateFile)}>Generate blank file ↓</button></div>
      <p className="helper">Downloads a blank file for you to upload with Add file → Browse.</p>
    </section>

    {connected && <>
      <div className="tools">
        <button type="button" disabled={disabled || !ready} onClick={() => void act(async () => {
          const next = await save()
          const result = await send({ type: 'SCAN', settings: next })
          await send({ type: 'FILL', settings: next, values: result.scan!.fields.filter(field => field.status === 'ready').map(field => ({ id: field.id, value: field.value })) })
        })}>Fill this page</button>
        <span>·</span>
        <button type="button" disabled={disabled || !scan.temporaryCount} onClick={() => void act(() => send({ type: 'CLEAR' }))}>Clear this page</button>
        <span>·</span>
        <button type="button" disabled={busy} onClick={() => void act(() => send({ type: 'SCAN', settings }))}>Refresh</button>
      </div>
      <details className="questions">
        <summary>Questions & options <span>{scan.sections.length ? `${scan.sections.length} sections` : 'Current page'}</span></summary>
        <div className="file-tools">
          <label className="optional"><input type="checkbox" disabled={disabled} checked={settings.includeOptional} onChange={event => setSettings(previous => ({ ...previous, includeOptional: event.target.checked }))} /> Fill optional questions</label>
          <label className="optional"><input type="checkbox" disabled={disabled} checked={settings.attachFiles} onChange={event => setSettings(previous => ({ ...previous, attachFiles: event.target.checked, fileMode: event.target.checked ? 'attach' : 'download' }))} /> Automatically attach files (optional)</label>
          <p className="helper">Blank PNG: transparent image. Blank PDF: empty page. TXT: zero bytes.</p>
        </div>
        <div className="outline">
          {!scan.outlineAvailable && <p className="helper">Only this page’s questions are available.</p>}
          {(scan.outlineAvailable ? scan.sections : [{ title: 'Current page', description: '', questions: scan.fields.map(field => ({ title: field.title, description: field.note || '', type: field.kind, required: field.required, options: field.options || [], rows: [] })) }]).map((section, index) => <details className="section" key={index} open={scan.sections.length <= 1}>
            <summary>{section.title}<small>{section.questions.length}</small></summary>
            {section.description && <p className="helper">{section.description}</p>}
            <ol>{section.questions.map((question, i) => <li key={i}><strong>{question.title}{question.required && ' *'}</strong><small>{question.type}</small>{question.description && <p>{question.description}</p>}{!!question.options.length && <p>{question.options.join(' · ')}</p>}{!!question.rows.length && <p>Rows: {question.rows.join(' · ')}</p>}</li>)}</ol>
          </details>)}
          <p className="helper">Choices can lead to different branches. A run follows one route.</p>
        </div>
      </details>
      {!!scan.temporaryCount && <p className="tracked">{scan.temporaryCount} temporary answer{scan.temporaryCount === 1 ? '' : 's'} tracked in this tab.</p>}
    </>}
    {scan && !connected && <p className="notice">Open the form’s respondent link and finish signing in first.</p>}
    <footer>Existing answers stay. Choices are random. Generate a blank file, then upload it yourself. Google may autosave—replace placeholders before submitting.</footer>
  </main>
}

export default Popup
