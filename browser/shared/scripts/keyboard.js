// HERMES Keyboard Shortcut Manager
// Uses Mousetrap for keybinding, loaded as a global before this script

(function () {
  'use strict'

  var keymap = {}
  var bound = false

  var INPUT_SELECTORS = 'input, textarea, [contenteditable="true"]'

  // Shortcuts that should still fire when focus is inside an input/textarea
  var INPUT_WHITELIST = ['mod+enter']

  function isDev() {
    return (
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1' ||
      new URLSearchParams(location.search).has('dev')
    )
  }

  function isInputFocused() {
    var el = document.activeElement
    if (!el) return false
    // Check the element itself and any shadow DOM
    try {
      if (el.matches(INPUT_SELECTORS)) return true
      if (el.shadowRoot && el.shadowRoot.activeElement) return true
    } catch (_) {
      // cross-origin iframe or similar — ignore
    }
    return !!el.closest(INPUT_SELECTORS)
  }

  function dispatch(action) {
    window.dispatchEvent(new CustomEvent('hermes:shortcut:' + action))
    if (isDev()) {
      console.log('[keyboard] shortcut: ' + action)
    }
  }

  // Mousetrap uses Mousetrap.prototype.bind, but sequences like "g i"
  // and special keys like "#", "*", "/" need specific handling.
  // We load the keymap and bind each entry.

  function bindKey(keys, actions) {
    if (typeof Mousetrap === 'undefined') {
      if (isDev()) console.warn('[keyboard] Mousetrap not loaded')
      return
    }

    Mousetrap.bind(keys, function (e) {
      // Allow whitelisted shortcuts even inside inputs (e.g. mod+enter for send)
      if (isInputFocused() && INPUT_WHITELIST.indexOf(keys) === -1) {
        return true
      }

      e.preventDefault()

      // actions can be a single string or an array (when multiple actions
      // share the same keybinding, for context-dependent dispatch)
      var list = Array.isArray(actions) ? actions : [actions]
      for (var i = 0; i < list.length; i++) {
        dispatch(list[i])
      }

      if (isDev()) {
        console.log(
          '[keyboard] dispatched: [' + list.join(', ') + '] (' + keys + ')'
        )
      }

      return false
    })
  }

  async function init() {
    // Load keymap from JSON
    try {
      var res = await fetch('/shared/data/keymap.json')
      if (res.ok) {
        keymap = await res.json()
      }
    } catch (_) {
      // fallback: keymap stays empty; no shortcuts registered
    }

    if (bound) return
    bound = true

    // Group actions by keybinding so identical keys dispatch all relevant
    // actions (context-dependent shortcuts like shift+r for both refresh
    // and reply-all)
    var byKeys = {}
    Object.keys(keymap).forEach(function (action) {
      var keys = keymap[action]
      if (!byKeys[keys]) byKeys[keys] = []
      byKeys[keys].push(action)
    })

    // Register each unique keybinding with Mousetrap
    Object.keys(byKeys).forEach(function (keys) {
      var actions = byKeys[keys]
      bindKey(keys, actions.length === 1 ? actions[0] : actions)
    })

    // Help panel shortcut: "?"
    // Not in keymap.json because it dispatches a dedicated event, not a
    // regular action.  We register it manually here.
    if (typeof Mousetrap !== 'undefined') {
      Mousetrap.bind('?', function (e) {
        if (isInputFocused()) return true
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('hermes:shortcut:show-help'))
        if (isDev()) {
          console.log(
            '[keyboard] Show shortcut help panel — press ? to see all shortcuts'
          )
        }
        return false
      })
    }

    if (isDev()) {
      console.log(
        '[keyboard] Initialized with ' +
          Object.keys(byKeys).length +
          ' keybindings'
      )
    }
  }

  function destroy() {
    if (typeof Mousetrap !== 'undefined') {
      Mousetrap.reset()
    }
    bound = false
  }

  // Exports
  window._hermesKeyboard = { init: init, destroy: destroy }

  // Auto-init after DOM ready (in case the init call from imports.js
  // somehow missed us — belt and suspenders)
  //
  // We only auto-init if Mousetrap was already loaded and the script
  // is placed after the mousetrap script tag.
})()
