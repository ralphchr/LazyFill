function isGoogleForm(): boolean {
  const hostname = window.location.hostname
  const pathname = window.location.pathname

  const isGoogleDomain = hostname.includes('google.com')
  const isFormsPath = pathname.includes('/forms/') || hostname.includes('forms.google.com')

  if (!isGoogleDomain || !isFormsPath) {
    return false
  }

  const formIndicators = [
    '.quantumWizForm',
    '.docjsForm',
    '[role="form"]',
    '#viewform',
  ]

  return formIndicators.some((selector) => document.querySelector(selector) !== null)
}

chrome.runtime.onMessage.addListener(
  (_message: { type: string }, _sender, sendResponse: (response: { type: string; isGoogleForm: boolean }) => void) => {
    if (_message.type === 'CHECK_FORM') {
      sendResponse({ type: 'FORM_RESULT', isGoogleForm: isGoogleForm() })
    }
  }
)