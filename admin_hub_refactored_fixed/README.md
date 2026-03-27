# Refactored Admin Hub

This version was refactored to be easier to work on in Claude or any code editor.

## What changed
- Moved the main inline CSS into `assets/css/styles.css`
- Moved the main inline JavaScript into `assets/js/app.js`
- Extracted embedded base64 images into `assets/img/`
- Updated `index.html` to reference those external files

## Why this helps
- Smaller HTML file
- Much easier to paste sections into Claude
- Cleaner structure for edits and debugging

## Suggested workflow with Claude
1. Paste only the section you want help with.
2. For visual changes, paste the relevant block from `styles.css`.
3. For behavior changes, paste the relevant function from `app.js`.
4. Avoid pasting the whole project at once.
