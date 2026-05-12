// @ts-check
export default class extends Tac {
  $items = []
  $loading = true

  get canUseApp() { return !!window._hermes?.auth?.isLoggedIn }
  get canShowLogin() { return !!window._hermes && !this.canUseApp }

  @onMount
  async init() {
    await this.load()
  }

  async load() {
    this.$loading = true
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) { this.$loading = false; return }
    try {
      const res = await apiFetch('/send/scheduled')
      if (res?.ok) this.$items = await res.json()
    } catch { this.$items = [] }
    finally { this.$loading = false }
  }

  async cancelScheduled(id) {
    if (!confirm('Cancel this scheduled send?')) return
    const apiFetch = window._hermes?.apiFetch; if (!apiFetch) return
    try {
      const res = await apiFetch('/send/scheduled', { method: 'DELETE', body: JSON.stringify({ id }) })
      if (res?.ok) {
        window._hermes?.toast('Scheduled send cancelled.')
        this.$items = this.$items.filter(item => item.id !== id)
      } else {
        window._hermes?.toast('Failed to cancel.')
      }
    } catch {
      window._hermes?.toast('Network error.')
    }
  }
}
