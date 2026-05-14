// @ts-check

/**
 * Compose email page.
 *
 * Provides the shell for the compose-email view. Delegates rendering to the
 * `<hm-compose>` component. The page itself only exposes auth-guard getters
 * that are consumed by the app-shell template to show/hide the login prompt
 * versus the compose UI.
 */
export default class extends Tac {
  /**
   * Whether the current user is authenticated and the app can be used.
   * @type {boolean}
   */
  get canUseApp() { return !!window._caduceus?.auth?.isLoggedIn }

  /**
   * Whether the login prompt should be shown (app is loaded but user is not
   * authenticated).
   * @type {boolean}
   */
  get canShowLogin() { return !!window._caduceus && !this.canUseApp }
}
