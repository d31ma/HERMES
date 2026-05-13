// @ts-check

/**
 * Folder view page (parameterised by folder name).
 *
 * Displays the email list for an arbitrary folder identified by the `_name`
 * route parameter. Supports single-email selection (read-only preview in the
 * detail pane) and exposes auth-guard getters for the app shell.
 */
export default class extends Tac {
  /** @type {string} */
  $selectedMail = ''

  /**
   * The current folder name, derived from the route parameter.
   * Falls back to the first path segment or 'inbox'.
   * @type {string}
   */
  get folderName() {
    const p = this.props || {}
    return /** @type {string} */ (p.folder) || location.pathname.split('/')[1] || 'inbox'
  }

  /**
   * Whether the current user is authenticated and the app can be used.
   * @type {boolean}
   */
  get canUseApp() { return !!window._hermes?.auth?.isLoggedIn }

  /**
   * Whether the login prompt should be shown (app is loaded but user is not
   * authenticated).
   * @type {boolean}
   */
  get canShowLogin() { return !!window._hermes && !this.canUseApp }

  /**
   * Handles the mail-selected event from the email list component.
   * @param {CustomEvent} e - The custom event carrying the selected email ID.
   */
  mailSelected(e) { if (e?.detail) this.$selectedMail = e.detail }

  /**
   * Clears the currently selected mail ID.
   */
  mailDeselected() { this.$selectedMail = '' }
}
