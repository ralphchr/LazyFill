<div align="center">

![FormPass — look ahead, finish when you're ready](docs/banner.svg)

**Your answers can wait. Your planning doesn’t have to.**

Set your common placeholders once. Let FormPass fill the remaining sections and stop before Submit.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-234f42?style=flat-square)
![React](https://img.shields.io/badge/React-19-234f42?style=flat-square)
![TypeScript](https://img.shields.io/badge/TypeScript-6-234f42?style=flat-square)
![Edge + Chrome](https://img.shields.io/badge/Edge_%2B_Chrome-supported-daf49b?style=flat-square&labelColor=234f42)

[Get started](#get-started) · [How it works](#how-it-works) · [Supported questions](#supported-questions) · [Development](#development)

</div>

---

You open an application form. The first section wants your final details and a PDF you’re still polishing. You just want to know what comes next.

**FormPass gives you two ways forward:** read the available questions without answering anything, or run automatic filling from the current section to the final page.

### What you can do

- **Set five placeholders:** name, contact number, birthday, Gmail/email, and age. Common English question labels are matched automatically, including first/last names and phone/mobile labels.
- **Match the field’s format:** ordinary text gets `.`, number-only fields get `0`, and alphanumeric-only fields get a value such as `A0`. Common patterns, input hints, instructions, and embedded Google validation are checked where available. Fixed-length numeric codes use repeated zeros.
- **Randomize choices:** radio buttons, checkboxes, dropdowns, and supported grid rows pick an available option at random. Existing selections stay in place.
- **Run all remaining sections:** fill, click Next, and repeat—even when the popup closes or Google reloads the page. Stop at any time from the popup or the form banner.
- **Generate a temporary file:** click **Generate blank file** in the extension to download a random blank PNG, PDF, or TXT. Then choose that download in the form’s upload window. A specific file type can also be selected.
- **Keep it simple:** one Run button, five profile inputs, a visible file generator, and a collapsed **Questions & options** panel for secondary tools.
- **Read ahead and clean up:** inspect available questions without uploads, or clear unchanged placeholders on the current page.

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
Name · Contact · Birthday · Gmail · Age
              ↓
       Run all sections
              ↓
 Fill blanks → Next → Fill blanks → Next
              ↓
  Stop at the final page. Never submit.
```

1. Open your form and click **FormPass**.
2. Edit the five placeholder values. These are saved locally when you run or fill a page.
3. Click **Run all sections**. You can close the popup; the form tab continues the run.
4. If an upload is required, click **Generate blank file**, select the download with the form’s **Add file → Browse** controls, then click **Continue all sections**. Other validation issues can be resolved directly in the form.
5. Replace or clear temporary answers before submitting your real response.

The runner starts from the current section and follows the route chosen by existing answers or random options. It does not visit every conditional branch. Repeated sections, missing controls, blocked tab storage, and validation errors stop the run instead of retrying indefinitely. Inactive runs expire after ten minutes; runs also have a 100-section limit.

**Fill this page** fills without navigating. **Clear this page** removes only unchanged tracked values. The file generator is visible without expanding any panel and works even when the active tab is not a Google Form. Expand **Questions & options** for preferences and a read-only outline of available sections. The outline uses data already supplied by Google; it cannot reveal questions absent from the loaded page data.

### Blank upload files

| Format | Contents |
| --- | --- |
| PNG | Valid transparent 1×1 image |
| PDF | Valid one-page PDF with an empty content stream |
| TXT | Empty file, zero bytes |
| Random | Randomly selects one of the supported formats |

**The default workflow is generate → download → upload yourself.** Choose **Random file type**, **Blank PNG**, **Blank PDF**, or **Empty TXT**, then click **Generate blank file**. The extension creates the file locally and downloads it to your computer. In Google’s upload window, click **Browse** and select the file from Downloads. You can generate the file while that window is already open.

**Automatic attachment is optional and off by default, including after upgrading from older releases.** To enable it, expand **Questions & options** and check **Automatically attach files (optional)** before running. In that mode, close an existing picker first. FormPass opens the correct question’s picker, checks formats and size limits, transfers a blank file through the input or drop zone, and waits for the named attachment in the form plus picker closure. Random mode prefers PNG/PDF when accepted. Existing files are preserved.

If an optional automatic attempt remains unconfirmed, finish it manually, or close the picker and use **Clear this page** to reset that attempt before continuing. Generating a download itself never opens or changes the form’s picker.

PNG and PDF files include the structure needed to open correctly, so they are not zero-byte files. Blank files can still be rejected by a form’s restrictions. Unsupported file formats need a file you supply yourself. Clearing a local input does not delete a file already uploaded to Google Drive.

### Supported questions

| Question | Temporary filling | Read-ahead outline |
| --- | --- | --- |
| Short answer and paragraph | Yes | Yes |
| Name, contact number, birthday, Gmail/email, age | Saved common placeholders | Yes |
| Other number-only fields | `0`, or repeated zeros for a required length | Yes |
| Alphanumeric-only fields | Letters and digits, adapted to common length/case rules | Yes |
| Other email and website inputs | Valid placeholder formats | Yes |
| Multiple choice and linear scale | One random available option | Yes |
| Checkboxes | One random available option | Yes |
| Dropdown | One random available option | Yes |
| Native dates and recognized birthday components | Yes | Yes |
| Grids with accessible choice rows | Random row choices; preserves answered rows | Yes |
| Time and unrecognized composite controls | Manual | Yes |
| File upload | Generate a blank download and upload it yourself; automatic attachment is optional | Yes |

Question outlines depend on Google exposing its embedded question data. Current-page filling remains available if that outline cannot be read.

### A few things to know

**Required checks still apply.** FormPass does not bypass required uploads or sign-in. Use the question outline to read ahead without uploading. Inside the actual form, required questions and Google’s validation must be satisfied before Next can advance.

**Temporary answers can be autosaved by Google.** Replace or clear them before you leave a form or submit it. Automatic mode clicks Next but never Submit. Its additional submission guard recognizes Google’s known Submit button and common labels; treat it as an extra reminder, not a guarantee against every possible manual submission path.

**Clearing is conservative.** It clears tracked values only when they still match the inserted placeholder. Visit earlier sections to clear their values. Some custom radio or dropdown selections need manual clearing if Google provides no usable reset control. If you replace a placeholder with a real answer, it is left alone.

**Matching and validation have limits.** Profile matching uses common English labels. Number ranges, answer patterns, checkbox minimums, “Other” choices, time fields, and unrecognized grids can require manual edits. Existing answers are never replaced to make a placeholder pass validation.

Age and contact-number questions use their saved profile values. For number-only contact fields, formatting characters such as spaces, `+`, and dashes are removed; the default contact placeholder is `0`. Zero placeholders still have to satisfy the form’s range rules—a field requiring a positive number will pause for your input. Complex or unavailable validation rules may also need manual completion.

### Privacy & permissions

No backend, accounts, analytics, or external file-generation service. Google may save drafts or uploaded files as it normally does when a form is edited.

| Permission or storage | Purpose |
| --- | --- |
| `activeTab` | Identify the active form when you open the popup |
| `storage` | Save the profile and preferences in `chrome.storage.local` |
| Content script on `https://docs.google.com/forms/*` | Read the form and fill supported respondent pages |
| Form tab’s `sessionStorage` | Track inserted values and run progress across navigation in that tab |

Existing real answers and file contents are not copied into tracking storage. Session tracking is scoped to the form URL and tab; site scripts can access that tab’s site storage. If site storage is blocked, automatic navigation is unavailable and manual filling tracks only the current document. Clearing browser data or losing the session can remove tracking before Google’s saved draft is cleared.

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
  popup/             Compact profile, Run/Stop, question outline, blank downloads
  content-script/    Scanning, filling, tracking, automatic navigation, outline
  shared/            Message types, profile matching, random choices, blank files
scripts/package.mjs  Extension manifest, PNG icons, package checks
tests/               Regression tests and a local browser fixture
manifest.json        Source manifest (packaged into dist/)
```

For a local UI walkthrough, run `npm run dev` and open `/tests/fixtures/popup.html` on the Vite server. The fixture uses a simulated form and extension API, so no live responses are sent. Its **Simulate completed upload** button lets a paused run continue to the next test section.

The packaged smoke test checks generated download links and file types, file generation on non-form tabs, manual file defaults, filling, clearing, read-ahead, automation after popup closure, an explicitly enabled simulated picker upload, and stopping before submission. Google’s page markup, picker, and embedded data format are undocumented and may change. A synthetic picker test does not verify Google’s live upload service.

### Troubleshooting

| Symptom | Try this |
| --- | --- |
| Blank popup or missing files | Build again and load `dist/`; remove the old root-folder installation |
| “Reload the Google Form” | Reload the extension, then reload the form tab |
| Form not detected | Use a respondent `viewform` link, finish sign-in, and wait for questions to load |
| No section outline | Reload; some forms do not expose readable question data |
| Next still refuses to continue | Review the form’s validation errors and complete uploads or manual questions |
| Automatic run pauses | Fix the question in the form, then click Continue all sections |
| Google’s picker needs a file | Click Generate blank file in FormPass, then Browse and select it from Downloads |
| An upload window is already open | Generate a file, then select it manually; only the optional automatic attachment mode requires closing an existing picker |
| Upload remains unconfirmed | Finish it manually, or close the picker and Clear this page before retrying |
| Temporary count remains | Return to earlier sections, or manually clear the remaining selections |

---

<div align="center">

**Prepare first. Answer with confidence.**

Built for the moment between “I need to see the questions” and “I’m ready to send.”

</div>
