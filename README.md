<div align="center">

![FormPass — look ahead, finish when you're ready](docs/banner.svg)

**Your answers can wait. Your planning doesn’t have to.**

Preview the questions ahead in a Google Form, then use temporary answers to explore at your own pace.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-234f42?style=flat-square)
![React](https://img.shields.io/badge/React-19-234f42?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-6-234f42?style=flat-square)
![Edge + Chrome](https://img.shields.io/badge/Edge_%2B_Chrome-supported-daf49b?style=flat-square&labelColor=234f42)

[Get started](#get-started) · [How it works](#how-it-works) · [Supported questions](#supported-questions) · [Development](#development)

</div>

---

You open an application form. The first section wants your final details and a PDF you’re still polishing. You just want to know what comes next.

**FormPass gives you two ways forward:** read the available sections without answering anything, or fill blank fields with editable placeholders and use the form’s **Next** button.

### What you can do

- **Look ahead:** browse available sections, questions, choices, descriptions, required markers, and grid rows in a read-only outline.
- **Preview before filling:** edit each proposed temporary answer or leave it empty to skip the field.
- **Keep your work:** existing answers stay in place; blank optional questions are skipped by default.
- **Set your defaults:** save your preferred text, paragraph, email, number, and website placeholders on your device.
- **Clean up:** clear unchanged temporary answers on the current page. Tracking follows the form through navigation in the same tab.
- **Stay aware:** an on-page notice marks temporary answers. Recognized Submit actions are blocked while tracked answers remain.

### Get started

Requires **Node.js 24+** and a current desktop version of **Microsoft Edge or Google Chrome**.

```sh
npm ci
npm run build
```

1. Open `edge://extensions` or `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**, then select this project’s **`dist`** folder.
4. Open a Google Form’s respondent link. If it was already open, **reload the form**.
5. Click **FormPass** in your browser’s extensions menu. Pin it for easier access.

> Load **`dist/`**, not the repository root. The build packages the popup, content script, manifest, and PNG icons together. After changing source files, rebuild, reload the extension, and reload the form.

### How it works

```text
Open a Google Form
        │
        ├── All sections ──→ Read ahead, including upload questions
        │                   No answers or files needed
        │
        └── Current page ─→ Review temporary answers
                            ↓
                           Fill blank fields → Click the form’s Next button
                            ↓
                           Replace or clear placeholders before submitting
```

**All sections** reads question information already included in the loaded form page. It lists sections in document order, including branches you might not visit. It does not predict the route your answers will take, and it cannot reveal information Google has not supplied to your browser.

**Current page** fills supported visible questions using normal input and selection events. Existing answers are checked again before filling. Custom validation may still need a value you supply yourself.

### Supported questions

| Question | Temporary filling | Read-ahead outline |
| --- | --- | --- |
| Short answer and paragraph | Yes | Yes |
| Email, number, website inputs | Yes; editable defaults | Yes |
| Multiple choice and linear scale | Choose one available option | Yes |
| Checkboxes | Choose one available option | Yes |
| Dropdown | Choose one available option | Yes |
| Date, time, grids | Manual | Yes |
| File upload | Manual | Yes |

Question outlines depend on Google exposing its embedded question data. Current-page filling remains available if that outline cannot be read.

### A few things to know

**Uploads remain real uploads.** FormPass does not attach dummy files, bypass required uploads, or bypass sign-in. Use **All sections** to inspect later questions while your files are unfinished. To navigate inside the actual form, you must satisfy Google’s required-field checks.

**Temporary answers can be autosaved by Google.** Replace or clear them before you leave a form or submit it. FormPass never clicks Next or Submit for you. Its submission protection recognizes Google’s known Submit button and common labels; treat it as an extra reminder, not a guarantee against every submission path.

**Clearing is conservative.** It clears tracked values only when they still match the inserted placeholder. Visit earlier sections to clear their values. Some custom radio or dropdown selections need manual clearing if Google provides no usable reset control. If you replace a placeholder with a real answer, it is left alone.

**Validation still applies.** Number ranges, answer patterns, checkbox minimums, “Other” choices, and form-specific rules can require manual edits. Date/time components and grids are left for you to answer.

### Privacy & permissions

No backend, accounts, analytics, or external requests from the extension.

| Permission or storage | Purpose |
| --- | --- |
| `activeTab` | Identify the active form when you open the popup |
| `storage` | Save placeholder preferences in `chrome.storage.local` |
| Content script on `https://docs.google.com/forms/*` | Read the form and fill supported respondent pages |
| Form tab’s `sessionStorage` | Track only inserted temporary values across navigation in that tab |

Existing real answers are not copied into tracking storage. Session tracking is scoped to the form URL and tab; site scripts can access that tab’s site storage. If site storage is blocked, tracking lasts only for the current document. Clearing browser data or losing the session can remove tracking before Google’s saved draft is cleared.

### Development

```sh
npm run dev       # Popup UI in Vite; extension APIs require the installed build
npm test          # DOM-based filling, clearing, parsing, and guard regression tests
npm run lint      # ESLint
npm run check     # Lint + tests + build + packaged popup/content-script smoke test
npm run build     # TypeScript + popup + standalone content script + packaging
npm audit         # Dependency audit
```

```text
src/
  popup/             React popup, preview controls, settings
  content-script/    Form detection, question scanning, filling, tracking, outline
  shared/            Message types and placeholder defaults
scripts/package.mjs  Extension manifest, PNG icons, package checks
tests/               Regression tests and a local browser fixture
manifest.json        Source manifest (packaged into dist/)
```

For a local UI walkthrough, run `npm run dev` and open `/tests/fixtures/popup.html` on the Vite server. The fixture uses a simulated form and extension API, so no live responses are sent.

Before using a new build on an important form, try a form you own: check text, choices, dropdowns, Next/Back, custom validation, replacement, clearing, and the final Submit guard. Google’s page markup and embedded data format are undocumented and may change.

### Troubleshooting

| Symptom | Try this |
| --- | --- |
| Blank popup or missing files | Build again and load `dist/`; remove the old root-folder installation |
| “Reload the Google Form” | Reload the extension, then reload the form tab |
| Form not detected | Use a respondent `viewform` link, finish sign-in, and wait for questions to load |
| No section outline | Reload; some forms do not expose readable question data |
| Next still refuses to continue | Review the form’s validation errors and complete uploads or manual questions |
| Temporary count remains | Return to earlier sections, or manually clear the remaining selections |

---

<div align="center">

**Prepare first. Answer with confidence.**

Built for the moment between “I need to see the questions” and “I’m ready to send.”

</div>
