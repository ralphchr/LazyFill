# Lazy Fill: GForms Autofill

**Inspect and prepare multi-section Google Forms before finalizing your response.**

Lazy Fill is a Microsoft Edge and Google Chrome extension for reviewing form requirements while your information and documents are still being prepared. It provides question outlines, reusable placeholder values, a local temporary-file library, and automatic navigation through supported sections.

Automatic navigation stops before submission and pauses when a required upload or validation issue needs your attention.

[Installation](#installation) · [Usage](#usage) · [Temporary files](#temporary-files) · [Limitations](#limitations) · [Development](#development)

## Features

- **Question preview:** inspect available section and question outlines without entering answers or uploading documents.
- **Reusable profile:** save placeholders for name, email, contact number, birthday, and age.
- **Section automation:** fill supported unanswered fields and advance through one route of the form. Progress continues after the popup closes and across page loads.
- **Temporary-file management:** select files from your device, retain them locally, and assign a specific file to an upload question.
- **Controlled continuation:** pause for missing required files, validation failures, unsupported controls, or repeated sections. Continue from the current section after resolving the issue.
- **Answer preservation:** retain existing responses and clear only tracked placeholders that remain unchanged.

## Installation

### Requirements

- Node.js 24 or later and npm.
- A desktop version of Microsoft Edge or Google Chrome.

### Build the extension

```sh
git clone https://github.com/ralphchr/formpass.git lazy-fill
cd lazy-fill
npm ci
npm run build
```

### Load in your browser

1. Open `edge://extensions` or `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose the generated **`dist`** directory.
4. Open a Google Form respondent link and complete any required sign-in.
5. Reload the form, then open **Lazy Fill** from the browser's extensions menu.

After an update, rebuild the project, reload the extension, and refresh the form tab. Load the `dist` directory rather than the repository root.

## Usage

1. Enter your placeholder profile in Lazy Fill.
2. Add any files you intend to use under **Temporary files**. Where necessary, assign a file to a specific question.
3. Select **Run all sections**. Lazy Fill fills supported unanswered fields and advances through the form.
4. If the run pauses, resolve the indicated requirement and select **Continue all sections**.
5. Review and replace temporary responses and attachments before submitting your final response yourself.

Use **Stop automation** to pause a run. Under **Questions & options**, use **Fill this page** to fill without navigating, **Clear this page** to remove unchanged tracked placeholders, or **Refresh** to rescan the current section.

### Supported fields

| Field or question | Behavior |
| --- | --- |
| Name, email, contact number, birthday, and age | Uses the saved profile where labels or input types are recognized |
| Other text and paragraph fields | Inserts `.` |
| Number-only fields | Inserts `0`, repeated where a supported length rule requires it |
| Alphanumeric fields | Uses a value such as `A0`, adapted to supported length and case rules |
| Website inputs | Uses a valid URL placeholder |
| Multiple choice, checkboxes, dropdowns, and linear scales | Selects an available option at random |
| Supported grids | Fills unanswered rows with random choices |
| Native dates and recognized birthday components | Uses the saved birthday |
| File uploads | Attempts attachment of a selected compatible file; missing required uploads pause navigation |
| Time fields and unrecognized composite controls | Requires manual completion |

Age and contact fields retain their profile values. Supported numeric contact fields remove formatting characters. All inserted values remain subject to the form's validation.

## Temporary files

Select **Upload temporary files** or drag files into the extension. The library preserves their original names, types, and contents and remains available after closing the popup or navigating between sections.

For each upload question, choose a specific file or use **First compatible file**. A compatible library file may be reused across questions. If an explicitly assigned file is removed, Lazy Fill requires another selection rather than silently substituting a different file.

**Automatic attachment through Google's upload window is experimental and has not been verified against the live upload service.** Opening that window does not confirm an upload. If automatic attachment fails, use **Browse** in Google's window to select the file directly, complete the attachment, and then select **Continue all sections**.

Required uploads block navigation until an attachment is detected. Optional uploads may remain empty. Lazy Fill checks available format and size restrictions and pauses when an upload remains unconfirmed.

Removing a file from the extension library does not remove an existing Google Form attachment or delete a Drive file. Lazy Fill does not generate decoy files.

## Limitations

- **Conditional routing:** each run follows one route determined by existing answers or random selections. It does not visit every branch.
- **Question visibility:** outlines contain only the question data supplied by Google. Some forms do not expose a readable outline.
- **Validation:** required answers, uploads, sign-in, numeric ranges, and custom rules still apply. Common English labels and supported patterns are recognized; other formats may need manual input.
- **Navigation:** repeated sections, missing controls, and unavailable tab storage pause automation. Runs have a 100-section limit and expire after ten minutes of inactivity. Continue starts a fresh traversal from the current section.
- **Google compatibility:** Google's form and picker markup can change. Automated fixtures do not establish compatibility with every live form or upload window.
- **Drafts and submission:** Google may autosave temporary answers and attachments. Automatic navigation does not click Submit; the additional submission guard is a best-effort reminder for recognized controls.
- **Clearing:** only unchanged tracked values are cleared. Earlier sections must be revisited, and some custom selections require manual removal. Losing tracking data does not clear Google's saved draft.

## Privacy and permissions

Lazy Fill has no application backend, analytics, or separate account requirement. Selected files remain in extension storage until attached to a form or removed from the library. Google receives files when they are attached through its upload interface.

| Access or storage | Purpose |
| --- | --- |
| `activeTab` | Identifies the active form when the popup opens |
| `storage` | Stores profile values, file metadata, and preferences locally |
| Content script on `https://docs.google.com/forms/*` | Reads supported respondent forms and fills their controls |
| Extension IndexedDB | Retains files explicitly selected by the user |
| Form tab's `sessionStorage` | Tracks temporary answers, attachment references, and run progress for that form and tab |

Existing real answers are not copied into tracking storage. File contents are held in extension storage rather than the form's session storage. Site scripts can access the form tab's session storage. Browser storage limits apply, and clearing extension data removes the local file library.

## Development

Built with React, TypeScript, Vite, and Manifest V3.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Starts the local Vite development server |
| `npm run build` | Type-checks and packages the extension into `dist` |
| `npm test` | Runs the regression test suite |
| `npm run lint` | Runs ESLint |
| `npm run check` | Runs lint, tests, build, and packaged integration checks |

The local fixture at `/tests/fixtures/popup.html` provides a simulated form and extension API. It does not send live responses. The **Simulate completed upload** control resolves an upload blocker for navigation testing.

Packaged integration checks cover popup messaging, local file persistence, exact file transfer through the worker, picker document replacement, required-upload pauses, attachment confirmation before Next, and exclusion of final submission. These checks use simulated Google upload windows.

### Project structure

```text
src/
  popup/             Profile, file library, question outline, and run controls
  content-script/    Form scanning, filling, navigation, and attachment handling
  shared/            Types, validation, profile matching, and file storage
  background.ts      Transfers selected-file data to the content script
scripts/             Packaging and integration checks
tests/               Regression tests and local fixtures
manifest.json        Extension manifest
```

## Troubleshooting

| Issue | Resolution |
| --- | --- |
| Popup cannot connect | Reload the extension, refresh the form tab, and reopen Lazy Fill |
| Form is not detected | Use a respondent `viewform` link, complete sign-in, and wait for the form to load |
| Required file is missing | Add a compatible file to the library or attach it directly in the form, then Continue |
| Upload window opens without an attachment | Use Browse in Google's window, complete the upload, then Continue |
| File type or size is rejected | Choose a file that meets the question's restrictions |
| Run returns to a previous section | Review the branching answer and Continue from the current section |
| Upload remains unconfirmed | Finish the upload manually, or close the picker and use Clear this page before retrying |
| Temporary answers remain tracked | Revisit earlier sections and clear unchanged placeholders or remaining selections |
