// @ts-check

/**
 * App navigation sidebar component.
 *
 * Highlights the active navigation item (Inbox, Compose, Settings) based on the
 * current URL path. Listens for the `tachyon:navigate` event to keep the active
 * indicator in sync with client-side route changes.
 *
 * @extends Tac
 */
export default class extends Tac {
  /** @type {string} Current active view: 'inbox', 'compose', or 'settings' */
  $activeView = 'inbox'

  /**
   * Initialise the navigation component.
   *
   * Sets the active view for the current route and registers a global
   * `tachyon:navigate` listener. Uses a global guard so the listener is only
   * registered once even if multiple app-nav instances mount.
   *
   * @returns {void}
   */
  @onMount
  init() {
    this.updateActive()
    if (window._caduceusNavInitialised) return
    window._caduceusNavInitialised = true
    window.addEventListener('tachyon:navigate', () => this.updateActive())
  }

  /**
   * Inspect `location.pathname` and set `$activeView` to the matching route.
   *
   * Falls back to `'inbox'` when the path does not match any known route.
   *
   * @returns {void}
   */
  updateActive() {
    const path = location.pathname
    if (path.startsWith('/compose')) this.$activeView = 'compose'
    else if (path.startsWith('/settings')) this.$activeView = 'settings'
    else this.$activeView = 'inbox'
  }
}
