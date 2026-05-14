/// <reference types="mousetrap" />
/**
 * CADUCEUS Keyboard Shortcut Manager.
 *
 * Uses Mousetrap for keybinding (loaded as a global before this script).
 *
 * This module loads a JSON keymap from `/shared/data/keymap.json`,
 * groups actions that share the same keybinding, registers them with
 * Mousetrap, and dispatches `caduceus:shortcut:<action>` custom events.
 *
 * Input-aware: shortcuts are suppressed when focus is inside an input,
 * textarea, or contenteditable element, except for a configurable
 * whitelist (e.g. `mod+enter` for send).
 *
 * Exposes `window._caduceusKeyboard = { init, destroy }`.
 *
 * @module keyboard
 */

;(function () {
  'use strict'

  /** @type {Record<string, string>} Action → keybinding map (loaded from keymap.json) */
  var keymap = {}

  /** @type {boolean} Whether bindings have already been registered */
  var bound = false

  /** @type {string} CSS selector for elements that suppress shortcuts */
  var INPUT_SELECTORS = 'input, textarea, [contenteditable="true"]'

  /** @type {string[]} Shortcuts that fire even when focus is in an input */
  var INPUT_WHITELIST = ['mod+enter']

  /**
   * Check whether the app is running in development mode.
   *
   * Development mode is detected by `localhost` hostname, `127.0.0.1`, or
   * a `?dev` query parameter.  When active, extra `console.log` output is
   * emitted for debugging shortcuts.
   *
   * @returns {boolean} True if running in a development environment.
   */
  function isDev() {
    return (
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1' ||
      new URLSearchParams(location.search).has('dev')
    )
  }

  /**
   * Determine whether the currently focused element is a text-input field.
   *
   * Checks the active element against {@link INPUT_SELECTORS}, including
   * a shadow-DOM active-element lookup so that Material Web / Lit components
   * are handled correctly.
   *
   * @returns {boolean} True if an input, textarea, or contenteditable element has focus.
   */
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

  /**
   * Dispatch a custom `caduceus:shortcut:<action>` event on `window`.
   *
   * The rest of the application listens for these events to trigger
   * navigation, compose, send, and other keyboard-driven workflows.
   *
   * @param {string} action - The action name (without the `caduceus:shortcut:` prefix).
   */
  function dispatch(action) {
    window.dispatchEvent(new CustomEvent('caduceus:shortcut:' + action))
    if (isDev()) {
      console.log('[keyboard] shortcut: ' + action)
    }
  }

  // Mousetrap uses Mousetrap.prototype.bind, but sequences like "g i"
  // and special keys like "#", "*", "/" need specific handling.
  // We load the keymap and bind each entry.

  /**
   * Register a keybinding (or array of keybindings) with Mousetrap.
   *
   * When the keys are pressed:
   * 1. If focus is in a text input and the shortcut is not whitelisted,
   *    the event is passed through so the user can type normally.
   * 2. Otherwise the default is prevented and each associated action is
   *    dispatched as a `caduceus:shortcut:<action>` custom event.
   *
   * @param {string} keys - Mousetrap key-combination string (e.g. `'mod+enter'`, `'g i'`).
   * @param {string|string[]} actions - Single action name or array of action names to dispatch.
   */
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

  /**
   * Initialize the keyboard shortcut manager.
   *
   * Fetches `/shared/data/keymap.json`, groups actions by their keybinding,
   * registers every unique keybinding with Mousetrap, and manually adds the
   * `?` help-panel shortcut.  Safe to call multiple times — subsequent calls
   * are no-ops once bound.
   *
   * @async
   * @returns {Promise<void>}
   */
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
        window.dispatchEvent(new CustomEvent('caduceus:shortcut:show-help'))
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

  /**
   * Tear down all registered Mousetrap keybindings and reset internal state.
   *
   * After calling this, `init()` can be called again to re-register
   * shortcuts from a fresh keymap.
   */
  function destroy() {
    if (typeof Mousetrap !== 'undefined') {
      Mousetrap.reset()
    }
    bound = false
  }

  // Exports
  window._caduceusKeyboard = { init: init, destroy: destroy }

  // Auto-init after DOM ready (in case the init call from imports.js
  // somehow missed us — belt and suspenders)
  //
  // We only auto-init if Mousetrap was already loaded and the script
  // is placed after the mousetrap script tag.
})()
