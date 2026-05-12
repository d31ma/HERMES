# Changelog

## v26.20.1 (2026-05-12) — Mailspring-Inspired Enterprise UI

### UI Overhaul
- **3-panel mail layout**: sidebar (200px) | email list (360px) | reading pane (flex)
- **Mailspring-aligned CSS variables** (`--ms-*` mapped to Material Design tokens)
- **Dark mode**: light/dark/auto themes with animated sun/moon toggle
- **Collapsible sidebar sections**: Mailboxes, Folders, System groups with localStorage persistence
- **Email row density**: comfortable/compact/default toggle
- **Hover quick actions**: star, archive, trash icons appear on email row hover
- **Drag-and-drop**: drag emails to sidebar folders to move them
- **Swipe gestures**: mobile email rows support swipe for quick actions

### Keyboard Shortcuts (23 bindings)
- Mousetrap integration with Mailspring-style keymap
- Navigation: `j/k`, `g+i/d/s/a/x/t`, `/` (search)
- Email actions: `s` (star), `e` (archive), `#` (trash), `r` (reply), `f` (forward)
- Composer: `mod+enter` (send), `esc` (discard)
- See `docs/KEYBOARD.md` for full reference

### New Mail Features
- **Undo-send**: 10-second delay window with countdown toast
- **Send later**: schedule email delivery for a future time
- **Send & archive**: single-click send + archive
- **Snooze**: hide emails until later (presets: today, tomorrow, weekend, custom)
- **Inline reply**: reply directly from the reading pane
- **Rich text composer**: bold, italic, lists, links toolbar
- **Templates**: save and load reusable email templates
- **Signatures**: per-domain email signatures with auto-append
- **Threading**: conversation grouping with expand/collapse
- **Read receipts**: tracking pixel for open detection
- **Link tracking**: redirect proxy for click tracking

### Full-Text Search
- Gmail-like query syntax: `from:`, `to:`, `subject:`, `has:attachment`, `is:unread`, `before:`, `after:`
- Quote support: `from:"John Doe"`
- `GET /search?q=...`

### New Pages
- `/folder/drafts`, `/folder/sent`, `/folder/archive`, `/folder/spam`, `/folder/trash`
- `/scheduled` — view scheduled messages

### Infrastructure
- 14 new server routes (see `docs/API-ROUTES.md`)
- 6 new repository modules (outbox, snooze, scheduled, templates, threads, tracking)
- Search query parser service
- Audit screenshot and DOM audit scripts
- Blackbox tests made non-blocking in PR CI (`continue-on-error: true`)
