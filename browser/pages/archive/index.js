// @ts-check
export default class extends Tac {
  $selectedMail = ''
  get canUseApp() { return !!window._hermes?.auth?.isLoggedIn }
  get canShowLogin() { return !!window._hermes && !this.canUseApp }
  mailSelected(e) { if (e?.detail) this.$selectedMail = e.detail }
  mailDeselected() { this.$selectedMail = '' }
}
