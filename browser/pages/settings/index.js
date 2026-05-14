// @ts-check

/**
 * Settings page.
 *
 * Provides the shell for the user-settings view. Delegates rendering to the
 * `<hm-settings>` component. Exposes auth-guard getters so the app shell can
 * conditionally show the login prompt or the settings UI.
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
