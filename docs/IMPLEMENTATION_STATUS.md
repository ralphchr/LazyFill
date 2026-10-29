# Implementation status — 0.1.0

Implemented: reproducible Manifest V3 packaging, respondent-form detection, editable preview, configurable local placeholders, required/optional handling, existing-answer preservation, native text and choice filling, Google-style radio/checkbox/dropdown events, temporary-value tracking across same-tab navigation, conservative clearing, a temporary-answer notice, recognized Submit protection, and a read-only section outline from embedded question data.

Manual: file uploads, dates, times, grids, unsupported controls, and form-specific validation that a supplied placeholder does not satisfy. Navigation stays under user control.

Limitations: Google's DOM and embedded schema are undocumented. Outlines list available sections rather than predicting conditional routing. Site session storage may be blocked or cleared. Radio/dropdown resets depend on available form controls. Submission protection is a best-effort reminder for recognized submit actions, not a universal interception mechanism.

Automated validation: DOM fixtures cover detection, preservation, validation rollback, choice events, clearing, reload tracking, blocked storage, prior-section tracking, outline parsing, settings validation, and Submit/Next behavior. These fixtures do not replace testing against a real Google Form in Edge or Chrome.
