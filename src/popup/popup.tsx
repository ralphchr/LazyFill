import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/types.ts'
import type { Request, Response, ScanResult, Settings, TemporaryFile } from '../shared/types.ts'
import { formatSize } from '../shared/files.ts'
import { listUploads, removeUpload, saveUploads } from '../shared/upload-store.ts'

function Icon({ name }: { name: 'user' | 'upload' | 'layers' | 'arrow' | 'file' | 'close' | 'shield' }) {
  const paths = {
    user: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-3 2 2 3-3',
    upload: 'M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4',
    layers: 'm12 3 10 5-10 5L2 8l10-5M2 12l10 5 10-5M2 16l10 5 10-5',
    arrow: 'M5 12h14m-6-6 6 6-6 6', file: 'M14 2H5v20h14V7l-5-5v5h5M8 12h8m-8 4h6',
    close: 'm6 6 12 12M6 18 18 6', shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3m-4 9 3 3 5-6',
  }
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

function Popup() {
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const tabId = useRef<number | null>(null)
  const running = scan?.automation?.status === 'running'
  const connected = scan?.isGoogleForm === true
  const disabled = busy || running
  const status = scan?.automation
  const ready = scan?.fields.filter(field => field.status === 'ready').length || 0
  const fileFields = scan?.fields.filter(field => field.kind === 'file') || []

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
        const [tabs, stored, files] = await Promise.all([chrome.tabs.query({ active: true, currentWindow: true }), chrome.storage.local.get('settings'), listUploads()])
        if (cancelled) return
        const next = normalizeSettings(stored.settings)
        const order = next.uploadFiles.map(file => file.id)
        next.uploadFiles = [...order.flatMap(id => files.filter(file => file.id === id)), ...files.filter(file => !order.includes(file.id))]
        setSettings(next)
        const tab = tabs[0]
        if (!tab?.id || !tab.url?.startsWith('https://docs.google.com/forms/')) return
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
    setBusy(true); setError(''); setMessage('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not complete the action. Try again.') }
    finally { setBusy(false) }
  }

  async function save(next: Settings = settings) {
    const value = { ...next, text: '.', paragraph: '.' }
    await chrome.storage.local.set({ settings: value })
    return value
  }

  async function updateFiles(files: TemporaryFile[], assignments = settings.uploadAssignments) {
    const next = { ...settings, uploadFiles: files, uploadAssignments: assignments }
    setSettings(next)
    await save(next)
    if (connected) await send({ type: 'SCAN', settings: next })
  }

  function addFiles(files: File[]) {
    if (!files.length || disabled) return
    void act(async () => {
      const added = await saveUploads(files)
      await updateFiles([...settings.uploadFiles, ...added])
      setMessage(`${added.length} file${added.length === 1 ? '' : 's'} ready. Continue when you’re ready to attach them.`)
    })
  }

  async function stop() {
    for (let attempt = 0; attempt < 30; attempt++) {
      try { return await accept(await chrome.tabs.sendMessage(tabId.current!, { type: 'STOP' }) as Response) }
      catch { if (attempt < 29) await new Promise(resolve => window.setTimeout(resolve, 200)) }
    }
    throw new Error('The form is still loading. Use Stop in its banner once the page appears.')
  }

  return <main className="popup">
    <aside className="rail" aria-label="Workspace navigation">
      <span className="rail-mark" aria-hidden="true">f<span>↗</span></span>
      <a href="#profile" title="Your profile" aria-label="Your profile"><Icon name="user" /></a>
      <a href="#files" title="Temporary files" aria-label="Temporary files"><Icon name="upload" /></a>
      <a href="#questions" title="Questions and options" aria-label="Questions and options"><Icon name="layers" /></a>
      <span className="rail-bottom" title="Stops before submission"><Icon name="shield" /></span>
    </aside>
    <header><div><h1>FormPass<span className="brand-star">✳</span></h1><p className="eyebrow">YOUR FORM WORKSPACE</p></div><span className="version">v0.3.0</span></header>
    <div className="form-title"><span className={`dot ${connected ? 'connected' : ''}`} /><p>{connected ? scan.title || 'Untitled form' : 'Waiting for a Google Form'}</p></div>
    <div className="intro"><h2>A little prep.<br /><span>A lot less typing.</span></h2><p>Preview the next section, at your pace.</p></div>
    {!connected && !busy && !error && <p className="notice">Open a Google Form to begin. You can prepare temporary files here first.</p>}
    {error && <p className="notice error" role="alert">{error}</p>}
    {message && <p className="notice success" role="status">{message}</p>}
    {status && status.status !== 'idle' && <div className={`run-status ${status.status}`} role="status"><span className="status-dot" /><p>{status.message}</p></div>}

    <section className="card" id="profile">
      <div className="section-heading"><h3><span>01</span>Your profile</h3><span className="subtle">Saved on this device</span></div>
      <form id="profile-form" className="profile" onSubmit={event => { event.preventDefault(); void act(async () => { const next = await save(); await send({ type: 'START', settings: next }) }) }}>
        <div className="profile-grid">
          <label>Full name<input name="name" autoComplete="off" required disabled={disabled} value={settings.name} onChange={event => setSettings(previous => ({ ...previous, name: event.target.value }))} /></label>
          <label>Contact number<input name="contact" type="tel" autoComplete="off" required disabled={disabled} value={settings.contact} onChange={event => setSettings(previous => ({ ...previous, contact: event.target.value }))} /></label>
          <label className="wide">Gmail / email<input name="email" type="email" autoComplete="off" required disabled={disabled} value={settings.email} onChange={event => setSettings(previous => ({ ...previous, email: event.target.value }))} /></label>
          <label>Birthday<input name="birthday" type="date" required disabled={disabled} value={settings.birthday} onChange={event => setSettings(previous => ({ ...previous, birthday: event.target.value }))} /></label>
          <label>Age<input name="age" type="number" min="0" max="150" required disabled={disabled} value={settings.age} onChange={event => setSettings(previous => ({ ...previous, age: event.target.value }))} /></label>
        </div>
      </form>
      <div className="defaults"><span>Other answers</span><code>Text .</code><code>Number 0</code><code>Code A0</code></div>
    </section>

    <section className="card uploads-card" id="files">
      <div className="section-heading"><h3><span>02</span>Temporary files</h3><span className="count">{settings.uploadFiles.length}</span></div>
      <label className={`upload-zone ${disabled ? 'disabled' : ''}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); addFiles([...event.dataTransfer.files]) }}>
        <input className="file-input" type="file" multiple aria-label="Upload temporary files" disabled={disabled} onChange={event => { addFiles([...event.target.files || []]); event.target.value = '' }} />
        <span className="upload-icon"><Icon name="upload" /></span><strong>Upload temporary files</strong><span>Choose files or drop them here</span>
      </label>
      {!!settings.uploadFiles.length && <ul className="file-list">{settings.uploadFiles.map(file => <li key={file.id}>
        <span className="file-icon"><Icon name="file" /></span><div><strong title={file.name}>{file.name}</strong><span>{formatSize(file.size)}</span></div>
        <button className="icon-button" aria-label={`Remove ${file.name}`} disabled={disabled} onClick={() => void act(async () => { await removeUpload(file.id); await updateFiles(settings.uploadFiles.filter(item => item.id !== file.id)) })}><Icon name="close" /></button>
      </li>)}</ul>}
      <p className="helper">Files stay on this device until you run. The first compatible file can be reused across questions.</p>
      {!!fileFields.length && <div className="file-assignments">{fileFields.map(field => <label key={field.id}><span>{field.title}{field.required && <em>Required</em>}</span>
        {field.status === 'answered' ? <span className="attached">✓ Attached in form</span> : <select aria-label={`File for ${field.title}`} disabled={disabled} value={settings.uploadAssignments[field.id] || ''} onChange={event => { const id = event.target.value; void act(() => updateFiles(settings.uploadFiles, { ...settings.uploadAssignments, [field.id]: id })) }}><option value="">{settings.uploadFiles.length ? 'First compatible file' : 'No file selected'}</option>{settings.uploadAssignments[field.id] && !settings.uploadFiles.some(file => file.id === settings.uploadAssignments[field.id]) && <option value={settings.uploadAssignments[field.id]} disabled>Assigned file removed · choose another</option>}{settings.uploadFiles.map(file => <option key={file.id} value={file.id}>{file.name}</option>)}</select>}
      </label>)}</div>}
      <div className="upload-rule"><Icon name="shield" /><p>Missing a required file? The run pauses here until you provide it.</p></div>
    </section>

    <details className="questions card" id="questions">
      <summary><h3><span>03</span>Questions & options</h3><span className="summary-arrow">⌄</span></summary>
      <label className="optional"><input type="checkbox" disabled={disabled} checked={settings.includeOptional} onChange={event => setSettings(previous => ({ ...previous, includeOptional: event.target.checked }))} /> Fill optional questions</label>
      {connected && <div className="tools"><button type="button" disabled={disabled || !ready} onClick={() => void act(async () => { const next = await save(); const result = await send({ type: 'SCAN', settings: next }); await send({ type: 'FILL', settings: next, values: result.scan!.fields.filter(field => field.status === 'ready').map(field => ({ id: field.id, value: field.value })) }) })}>Fill this page</button><button type="button" disabled={disabled || !scan.temporaryCount} onClick={() => void act(() => send({ type: 'CLEAR' }))}>Clear this page</button><button type="button" disabled={busy} onClick={() => void act(() => send({ type: 'SCAN', settings }))}>Refresh</button></div>}
      <div className="outline">{(scan?.outlineAvailable ? scan.sections : [{ title: 'Current section', description: '', questions: scan?.fields.map(field => ({ title: field.title, description: field.note || '', type: field.kind, required: field.required })) || [] }]).map((section, index) => <details className="section" key={index}><summary>{section.title}<small>{section.questions.length}</small></summary><ol>{section.questions.map((question, i) => <li key={i}><strong>{question.title}{question.required && ' *'}</strong><small>{question.type}</small>{question.description && <p>{question.description}</p>}</li>)}</ol></details>)}</div>
      <p className="helper">Random choices follow one route through the form.</p>
    </details>
    <footer>Google may autosave. Replace temporary answers and files before submitting.</footer>
    <div className="action-bar">{running ? <button className="primary stop" type="button" disabled={busy} onClick={() => void act(stop)}>Stop automation <span>■</span></button> : <button className="primary" form="profile-form" type="submit" disabled={busy || !connected}>{busy ? 'Preparing…' : status?.status === 'paused' ? 'Continue all sections' : 'Run all sections'}<Icon name="arrow" /></button>}<p>Stops before Submit<span>●</span>{scan?.temporaryCount || 0} temporary answers</p></div>
  </main>
}

export default Popup
