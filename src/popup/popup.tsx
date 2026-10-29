import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/types.ts'
import type { Request, Response, ScanResult } from '../shared/types.ts'

const DEFAULT_LABELS = { text: 'Short answer', paragraph: 'Paragraph', email: 'Email', number: 'Number', url: 'Website' } as const

function Popup() {
  const [scan, setScan] = useState<ScanResult | null>(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [draft, setDraft] = useState(DEFAULT_SETTINGS)
  const [values, setValues] = useState<Record<string, string>>({})
  const [view, setView] = useState<'fill' | 'outline'>('fill')
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const tabId = useRef<number | null>(null)

  function accept(result: Response) {
    if (!result?.ok) throw new Error(result?.message || 'Could not read this form. Reload it and try again.')
    if (result.scan) {
      setScan(result.scan)
      setValues(Object.fromEntries(result.scan.fields.filter(field => field.status === 'ready').map(field => [field.id, field.value])))
    }
    if (result.message) setMessage(result.message)
  }

  async function send(request: Request) {
    if (tabId.current === null) throw new Error('Open a Google Form respondent page, then reopen FormPass.')
    let result: Response
    try { result = await chrome.tabs.sendMessage(tabId.current, request) as Response }
    catch { throw new Error('Reload the Google Form after installing or updating FormPass, then try again.') }
    accept(result)
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (typeof chrome === 'undefined' || !chrome.tabs) throw new Error('Load the dist folder as an unpacked extension in Edge or Chrome to use FormPass.')
        const [tabs, stored] = await Promise.all([chrome.tabs.query({ active: true, currentWindow: true }), chrome.storage.local.get('settings')])
        if (cancelled) return
        const tab = tabs[0]
        if (!tab?.id || !tab.url?.startsWith('https://docs.google.com/forms/')) throw new Error('Open a Google Form respondent page to get started. Short links work after they redirect to the form.')
        tabId.current = tab.id
        const next = normalizeSettings(stored.settings)
        setSettings(next)
        setDraft(next)
        const result = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN', settings: next }) as Response
        if (!cancelled) accept(result)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error && !/Receiving end|connection/i.test(cause.message) ? cause.message : 'Reload the Google Form after installing or updating FormPass, then reopen the popup.')
      } finally { if (!cancelled) setBusy(false) }
    })()
    return () => { cancelled = true }
  }, [])

  async function act(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    setMessage('')
    try { await action() }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.') }
    finally { setBusy(false) }
  }

  const ready = scan?.fields.filter(field => field.status === 'ready') || []
  const selected = ready.filter(field => values[field.id]?.trim())
  const supported = scan?.isGoogleForm === true

  return (
    <main className="popup">
      <header className="header">
        <div className="brand-icon" aria-hidden="true">F<span>↗</span></div>
        <div><h1>FormPass</h1><p>Look ahead. Finish when you’re ready.</p></div>
        <span className="version">0.1</span>
      </header>

      <section className="intro">
        <span className="eyebrow">A LITTLE ROOM TO PREPARE</span>
        <h2>Your answers can wait.<br />Your planning doesn’t have to.</h2>
        <p>Explore the questions ahead, or use temporary answers to move through a form.</p>
      </section>

      {busy && <p className="notice" role="status">Working on it…</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice success" role="status">{message}</p>}

      {supported && <>
        <div className="form-heading"><div><span className="connected">● FORM CONNECTED</span><h3>{scan.title || 'Untitled form'}</h3></div><button className="icon-button" disabled={busy} onClick={() => void act(() => send({ type: 'SCAN', settings }))} aria-label="Refresh form scan">↻</button></div>
        <nav className="tabs" aria-label="FormPass tools">
          <button className={view === 'fill' ? 'active' : ''} aria-pressed={view === 'fill'} onClick={() => setView('fill')}>Current page <span>{scan.fields.length}</span></button>
          <button className={view === 'outline' ? 'active' : ''} aria-pressed={view === 'outline'} onClick={() => setView('outline')}>All sections <span>{scan.sections.length || '—'}</span></button>
        </nav>

        {view === 'outline' ? <section className="outline">
          <p className="helper">Read ahead without filling fields or uploading files. This lists available sections; your choices may take you along different branches.</p>
          {!scan.outlineAvailable && <p className="notice">Google hasn’t exposed a readable question outline on this page. Try reloading; current-page filling is still available.</p>}
          {scan.sections.map((section, index) => <details className="section-card" key={index} open={scan.sections.length === 1}>
            <summary><span className="section-number">{String(index + 1).padStart(2, '0')}</span><span>{section.title}</span><small>{section.questions.length} questions</small></summary>
            {section.description && <p className="description">{section.description}</p>}
            <ol className="question-list">{section.questions.map((question, questionIndex) => <li key={questionIndex}>
              <strong>{question.title}{question.required && <span className="required"> *</span>}</strong>
              <span className="question-type">{question.type}</span>
              {question.description && <p>{question.description}</p>}
              {!!question.options.length && <p className="option-list">{question.options.join(' · ')}</p>}
              {!!question.rows.length && <p className="option-list">Rows: {question.rows.join(' · ')}</p>}
              {question.type === 'File upload' && <p className="upload-note">Upload your file manually when it’s ready.</p>}
            </li>)}</ol>
            {!section.questions.length && <p className="description">No questions in this section.</p>}
          </details>)}
        </section> : <section>
          <div className="list-heading"><h4>Preview temporary answers</h4><span>{ready.length} blank</span></div>
          <p className="helper">Existing answers are kept. Edit a value below, or leave it empty to skip that field.</p>
          <div className="fields">{scan.fields.map(field => <article className={`field ${field.status}`} key={field.id}>
            <div className="field-title"><label htmlFor={`field-${field.id}`}>{field.title}{field.required && <span className="required"> *</span>}</label><span className="badge">{field.status === 'answered' ? 'Kept' : field.status === 'optional' ? 'Optional' : field.status === 'manual' ? 'Manual' : field.kind}</span></div>
            {field.status === 'ready' && (field.options ? <select id={`field-${field.id}`} disabled={busy} value={values[field.id] || ''} onChange={event => setValues(previous => ({ ...previous, [field.id]: event.target.value }))}>
              <option value="">Skip this field</option>{field.options.map((option, index) => <option key={index} value={option}>{option}</option>)}
            </select> : <input id={`field-${field.id}`} disabled={busy} value={values[field.id] || ''} onChange={event => setValues(previous => ({ ...previous, [field.id]: event.target.value }))} />)}
            {field.note && <p className="field-note">{field.note}</p>}
          </article>)}</div>
          {!scan.fields.length && <p className="notice">No questions found on this page. The form may be closed, loading, or waiting for sign-in.</p>}
          <button className="primary" disabled={busy || !selected.length} onClick={() => void act(() => send({ type: 'FILL', settings, values: selected.map(field => ({ id: field.id, value: values[field.id] })) }))}>Fill {selected.length || ''} temporary answer{selected.length === 1 ? '' : 's'} <span>↗</span></button>
          <p className="helper centered">Then use the form’s <strong>Next</strong> button. Review any validation messages.</p>
        </section>}

        {!!scan.temporaryCount && <div className="tracking"><p><strong>{scan.temporaryCount} temporary answer{scan.temporaryCount === 1 ? '' : 's'}</strong> tracked in this tab. Clear answers on each visited page; some selections need manual clearing.</p><button className="text-button" disabled={busy} onClick={() => void act(() => send({ type: 'CLEAR' }))}>Clear on this page</button></div>}
      </>}
      {scan && !supported && <p className="notice">This page isn’t an active Google Form. Open its respondent link, finish signing in if needed, then reopen FormPass.</p>}

      <details className="settings">
        <summary>Placeholder settings <span>＋</span></summary>
        <form onSubmit={event => { event.preventDefault(); void act(async () => {
          await chrome.storage.local.set({ settings: draft })
          setSettings(draft)
          if (tabId.current !== null) await send({ type: 'SCAN', settings: draft })
          setMessage('Placeholder settings saved on this device.')
        }) }}>
          {Object.entries(DEFAULT_LABELS).map(([key, title]) => <label className="setting" key={key}>{title}<input value={draft[key as keyof typeof DEFAULT_LABELS]} disabled={busy} onChange={event => setDraft(previous => ({ ...previous, [key]: event.target.value }))} /></label>)}
          <label className="checkbox-setting"><input type="checkbox" checked={draft.includeOptional} disabled={busy} onChange={event => setDraft(previous => ({ ...previous, includeOptional: event.target.checked }))} /> Include blank optional questions</label>
          <button className="secondary" disabled={busy || typeof chrome === 'undefined' || !chrome.storage}>Save settings & refresh</button>
        </form>
      </details>
      <footer><strong>A draft is still a draft.</strong> Google may autosave temporary answers. Replace them before submitting. File uploads stay manual. FormPass never submits a form.</footer>
    </main>
  )
}

export default Popup
