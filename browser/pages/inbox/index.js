// @ts-check

/**
 * Inbox page.
 *
 * Primary email list view. Renders the inbox email list and supports
 * single-email selection. On narrow viewports (mobile) selecting an email
 * navigates directly to the email detail page instead of using the split-pane
 * layout.
 */
export default class extends Tac {
  /** @type {string} */
  $selectedMail = ''

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
   * Handles the mail-selected event from the email list.
   * On mobile viewports navigates directly to the email detail page.
   * @param {CustomEvent} e - The custom event carrying the selected email ID.
   */
  mailSelected(e) {
    if (e?.detail) this.$selectedMail = e.detail
    // On mobile, navigate to email detail page
    if (window.innerWidth <= 760 && this.$selectedMail) {
      window._hermes?.navigate(`/email/${encodeURIComponent(this.$selectedMail)}`)
    }
  }

  /**
   * Clears the currently selected mail ID.
   */
  mailDeselected() {
    this.$selectedMail = ''
  }
}
