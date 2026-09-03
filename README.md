# FormPass

A Chromium-based browser extension for Microsoft Edge that temporarily fills Google Forms using user-defined placeholders, allowing users to navigate multi-page forms without completing their real answers.

## Current Development Status

This extension is at **Milestone 1: Foundation**. The popup successfully renders a React-based UI that detects whether the active tab is a Google Form. Blank/white popup issue has been resolved.

**Current capabilities:**
- Extension loads in `edge://extensions/`
- Popup visibly renders FormPass interface
- Google Form detection active (URL pattern + DOM indicators)
- React + TypeScript + Vite bundling functional
- Manifest V3 compliant

**Future milestones pending:** Placeholder configuration, field classification, multi-page navigation, preview before filling.

## Technology Stack

- **TypeScript** for type-safe configuration and components
- **React 19** for the popup UI
- **Vite 8** as the build tool and development server
- **Manifest V3** for the extension architecture
- **chrome.storage.local** for local-first storage (future)
- **ESLint** for code quality

## Installation

```powershell
npm install
```

## Build

```powershell
npm run build
```

This runs `tsc -b && vite build`, compiling TypeScript and bundling assets into the `dist/` directory.

## Loading into Microsoft Edge

1. Build the extension: `npm run build`
2. Open Edge and navigate to `edge://extensions/`
3. Enable **Developer mode** (toggle switch)
4. Click **Load unpacked**
5. Select the `formpass-webextension` directory (or `dist/` folder)
6. The FormPass extension should now appear in your extensions list

## Testing the Current Milestone

1. Load the extension in Edge as described above
2. Click the FormPass extension icon
3. The popup should render with the FormPass interface, showing:
   - "Google Form detected" (if on a Google Forms page) or
   - "Not a Google Form" (if on another page)
4. The popup should NOT be a blank/white box

## Current Limitations

- Extension only detects Google Forms; no filling or placeholder substitution yet
- Placeholder configuration (text, email, number, etc.) not implemented
- Automatic form filling not implemented
- Multi-page form navigation not implemented
- Automatic submission not implemented (safety constraint)
- CSS styles optimized for web pages, not extension popups (width may appear large)
- Extension requires manual reload after source changes