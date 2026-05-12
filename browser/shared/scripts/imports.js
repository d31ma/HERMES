// HERMES shell bootstrap — Material Design M2 + PWA setup

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
(function initTheme() {
  const stored = localStorage.getItem('hermes-theme')
  if (stored === 'light' || stored === 'dark') {
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

// Global toasts — rendered as Material snackbar
let _toastTimer
window._hermesShowToast = (msg, duration = 2500) => {
  clearTimeout(_toastTimer)
  let el = document.getElementById('hermes-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'hermes-toast'
    el.setAttribute('role', 'status')
    el.setAttribute('aria-live', 'polite')
    el.setAttribute('aria-atomic', 'true')
    el.style.cssText = 'position:fixed;bottom:1rem;left:50%;transform:translateX(-50%);z-index:9999;background:var(--md-sys-color-inverse-surface,#333);color:var(--md-sys-color-inverse-on-surface,#fff);padding:0.75rem 1.25rem;border-radius:8px;font-size:14px;font-family:IBM Plex Sans,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3);transition:opacity 0.3s;opacity:0;pointer-events:none'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.style.opacity = '1'
  _toastTimer = setTimeout(() => { el.style.opacity = '0' }, duration)
}
