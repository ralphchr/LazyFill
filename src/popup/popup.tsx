import { useState, useEffect } from 'react'

function Popup() {
  const [detected, setDetected] = useState<string | null>(null)

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || !tabs[0] || !tabs[0].id) return
      chrome.tabs.sendMessage(tabs[0].id, { type: 'CHECK_FORM' }, (response) => {
        if (chrome.runtime.lastError) return
        if (response?.type === 'FORM_RESULT') {
          setDetected(response.isGoogleForm ? 'Google Form detected' : 'Not a Google Form')
        }
      })
    })
  }, [])

  return (
    <div
      style={{
        minWidth: 280,
        padding: 20,
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
        border: '1px solid #e5e4e7',
        borderRadius: 8,
        margin: '80px auto 0',
        background: '#fff',
      }}
    >
      {detected !== null ? (
        <div style={{ marginTop: 12, fontSize: 16, fontWeight: 500 }}>{detected}</div>
      ) : (
        <div>Checking...</div>
      )}
    </div>
  )
}

export default Popup