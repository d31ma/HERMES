/**
 * HERMES shell bootstrap — Material Design M2 + PWA setup.
 *
 * Responsibilities:
 *   - Inject Google Fonts stylesheet (IBM Plex Sans + Mono).
 *   - Load Material Web components via CDN (esm.sh).
 *   - Initialize the colour-scheme theme from localStorage or OS preference.
 *   - Register the PWA service worker.
 *   - Chain-load Mousetrap and the HERMES keyboard shortcut manager.
 *   - Provide a global Material-style toast / snackbar renderer.
 *
 * This file should be loaded synchronously in `<head>` so that fonts,
 * theme, and the service worker start as early as possible.
 *
 * @module imports
 */

document.documentElement.lang = 'en'

if (!document.querySelector('link[data-demo-style]')) {
  const fonts = document.createElement('link')
  fonts.rel = 'stylesheet'
  fonts.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap'
  fonts.dataset.demoStyle = 'true'
  document.head.appendChild(fonts)

  const materialScript = document.createElement('script')
  materialScript.type = 'module'
  materialScript.src = 'https://esm.sh/@material/web/all.js?bundle'
  document.head.appendChild(materialScript)
}

// ── Theme initialization ──────────────────────────────────────────────

/**
 * Apply the persisted or system-prefered colour theme.
 *
 * Checks localStorage key `hermes-theme` first; if unset or unrecognized,
 * falls back to the OS `prefers-color-scheme` media query.  The result is
 * stored on `<html data-theme>` for CSS variable switching.
 */
;(function initTheme() {
  const stored = localStorage.getItem('hermes-theme')
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    document.documentElement.setAttribute('data-theme', stored)
  } else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.setAttribute('data-theme', prefersDark ? 'auto' : 'light')
  }
})()

if ('serviceWorker' in navigator && !window.__HERMES_DISABLE_SW) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

// ── Keyboard shortcuts ────────────────────────────────────────────────

/**
 * Chain-load Mousetrap then the HERMES keyboard manager.
 *
 * Appends `<script>` tags in order so that `keyboard.js` can rely on the
 * global `Mousetrap` binding.  Once both are loaded, `_hermesKeyboard.init()`
 * is called automatically.
 */
;(function loadKeyboard() {
  var mtScript = document.createElement('script')
  mtScript.src = '/shared/scripts/mousetrap.js'
  mtScript.onload = function () {
    var kbScript = document.createElement('script')
    kbScript.src = '/shared/scripts/keyboard.js'
    kbScript.onload = function () {
      if (window._hermesKeyboard) {
        window._hermesKeyboard.init()
      }
    }
    document.head.appendChild(kbScript)
  }
  document.head.appendChild(mtScript)
})()

// Global toasts — rendered as Material snackbar

/** @type {ReturnType<typeof setTimeout> | null} Auto-dismiss timeout ID */
let _toastTimer = null

/** @type {ReturnType<typeof setInterval> | null} Countdown interval ID */
let _toastCountdownTimer = null

/**
 * Display a Material-style toast / snackbar notification.
 *
 * Creates (or reuses) a fixed-position `<div id="hermes-toast">` with
 * ARIA live-region attributes.  Supports two calling conventions:
 *
 * 1. **Simple string** — `_hermesShowToast('Copied!', 3000)`
 * 2. **Interactive object** — `_hermesShowToast({ msg: 'Undo?', duration: 5000, action: { label: 'Undo', onClick: fn } })`
 *
 * When an action button is provided the toast becomes interactive
 * (pointer-events enabled) and displays a countdown label.  Clicking the
 * action button dismisses the toast early and invokes the callback.
 *
 * @param {string|{
 *   msg: string,
 *   duration?: number,
 *   action?: { label: string, onClick: Function }
 * }} msgOrOpts - Toast message text or configuration object.
 * @param {number} [duration=2500] - Display duration in milliseconds (ignored when the first argument is an object that provides its own `duration`).
 */
window._hermesShowToast = (msgOrOpts, duration = 2500) => {
  if (_toastTimer !== null) clearTimeout(_toastTimer)
  if (_toastCountdownTimer) if (_toastCountdownTimer !== null) clearInterval(_toastCountdownTimer)
  let el = document.getElementById('hermes-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'hermes-toast'
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    el.setAttribute('aria-atomic', 'true')
    el.style.cssText = 'position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);z-index:9999;background:var(--ms-inverse-surface,#333);color:var(--ms-inverse-on-surface,#fff);padding:0.75rem 1.25rem;border-radius:8px;font-size:14px;font-family:IBM Plex Sans,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 0.3s;opacity:0;pointer-events:none'
    document.body.appendChild(el)
  }
  // Support interactive toasts with action button
  if (typeof msgOrOpts === 'object' && msgOrOpts.msg) {
    const { msg, duration: dur, action } = msgOrOpts
    const d = dur ?? duration
    let seconds = Math.ceil(d / 1000)
    el.style.pointerEvents = 'auto'
    el.innerHTML = `<span id="hermes-toast-msg">${msg} <span id="hermes-toast-countdown">(${seconds}s)</span></span><button id="hermes-toast-action" style="margin-left:1rem;background:var(--ms-primary,#6750a4);color:#fff;border:none;border-radius:4px;padding:0.25rem 0.75rem;font-size:13px;cursor:pointer;font-family:inherit;font-weight:500;">${action?.label || ''}</button>`
    el.style.opacity = '1'

    // Countdown
    const countdownEl = document.getElementById('hermes-toast-countdown')
    _toastCountdownTimer = setInterval(() => {
      seconds--
      if (seconds <= 0) {
        if (_toastCountdownTimer !== null) clearInterval(_toastCountdownTimer)
        el.style.opacity = '0'; el.style.pointerEvents = 'none'
      } else if (countdownEl) {
        countdownEl.textContent = `(${seconds}s)`
      }
    }, 1000)

    // Action button
    const actionBtn = document.getElementById('hermes-toast-action')
    if (actionBtn && action?.onClick) {
      actionBtn.addEventListener('click', () => {
        if (_toastCountdownTimer !== null) clearInterval(_toastCountdownTimer)
        if (_toastTimer !== null) clearTimeout(_toastTimer)
        el.style.opacity = '0'; el.style.pointerEvents = 'none'
        action.onClick()
      })
    }

    _toastTimer = setTimeout(() => {
      if (_toastCountdownTimer !== null) clearInterval(_toastCountdownTimer)
      el.style.opacity = '0'; el.style.pointerEvents = 'none'
    }, d)
  } else {
    el.style.pointerEvents = 'none'
    el.innerHTML = ''
  el.textContent = typeof msgOrOpts === "string" ? msgOrOpts : msgOrOpts.msg
    el.style.opacity = '1'
    _toastTimer = setTimeout(() => { el.style.opacity = '0' }, duration)
  }
}
