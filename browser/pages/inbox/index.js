// @ts-check
export default class extends Tac {
  $selectedMail = ''

  get canUseApp() { return !!window._hermes?.auth?.isLoggedIn }
  get canShowLogin() { return !!window._hermes && !this.canUseApp }

  mailSelected(e) {
    if (e?.detail) this.$selectedMail = e.detail
    // On mobile, navigate to email detail page
    if (window.innerWidth <= 760 && this.$selectedMail) {
      window._hermes?.navigate(`/email/${encodeURIComponent(this.$selectedMail)}`)
    }
  }

  mailDeselected() {
    this.$selectedMail = ''
  }
}
