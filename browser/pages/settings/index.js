// @ts-check
export default class extends Tac {
  get canUseApp() { return !!window._hermes?.auth?.isLoggedIn }
  get canShowLogin() { return !!window._hermes && !this.canUseApp }
}
