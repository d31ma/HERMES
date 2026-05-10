// @ts-check
export default class extends Tac {
  $activeView = 'inbox'

  @onMount
  init() {
    this.updateActive()
    if (window._hermesNavInitialised) return
    window._hermesNavInitialised = true
    window.addEventListener('tachyon:navigate', () => this.updateActive())
  }

  updateActive() {
    const path = location.pathname
    if (path.startsWith('/compose')) this.$activeView = 'compose'
    else if (path.startsWith('/settings')) this.$activeView = 'settings'
    else this.$activeView = 'inbox'
  }
}
