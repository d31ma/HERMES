// @ts-check

/**
 * Scheduled emails page.
 *
 * Lists emails that have been scheduled for future delivery. On mount it
 * fetches the scheduled-send queue from the API and renders each item with a
 * cancel action. Exposes auth-guard getters for the app shell.
 */
export default class extends Tac {
  /** @type {Array<{ id: string, [key: string]: any }>} */
  $items = []
  /** @type {boolean} */
  $loading = true

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

  /**
   * Lifecycle hook — fetches the scheduled email list on mount.
   *
   * @async
   * @returns {Promise<void>}
   */
  @onMount
  async init() {
    await this.load()
  }

  /**
   * Fetches the list of scheduled (future-dated) emails from the API.
   *
   * @async
   * @returns {Promise<void>}
   */
  async load() {
    this.$loading = true
    const apiFetch = window._caduceus?.apiFetch; if (!apiFetch) { this.$loading = false; return }
    try {
      const res = await apiFetch('/send/scheduled')
      if (res?.ok) this.$items = await res.json()
    } catch { this.$items = [] }
    finally { this.$loading = false }
  }

  /**
   * Cancels a scheduled send after user confirmation.
   *
   * Sends a DELETE request to the API and removes the item from the local
   * list on success.
   *
   * @async
   * @param {string} id - The ID of the scheduled email to cancel.
   * @returns {Promise<void>}
   */
  async cancelScheduled(id) {
    if (!confirm('Cancel this scheduled send?')) return
    const apiFetch = window._caduceus?.apiFetch; if (!apiFetch) return
    try {
      const res = await apiFetch('/send/scheduled', { method: 'DELETE', body: JSON.stringify({ id }) })
      if (res?.ok) {
        window._caduceus?.toast('Scheduled send cancelled.')
        this.$items = this.$items.filter(item => item.id !== id)
      } else {
        window._caduceus?.toast('Failed to cancel.')
      }
    } catch {
      window._caduceus?.toast('Network error.')
    }
  }
}
