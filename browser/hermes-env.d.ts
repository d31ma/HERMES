/// <reference types="@d31ma/tachyon/globals" />

declare global {
  interface Window {
    _hermes?: {
      auth: {
        token: string | null
        email: string | null
        role: string | null
        domains: string[]
        isLoggedIn: boolean
      }
      apiFetch: (path: string, options?: Record<string, unknown>) => Promise<Response | null>
      toast: (msg: string, duration?: number) => void
      navigate: (target?: string) => void
      openEmail: (email: string | { id: string }) => void
      openEmailId: (id: string) => void
      compose: (prefill?: Record<string, unknown>) => void
      consumeComposePrefill: () => Record<string, unknown>
      handleLogin: (data: { token: string; email: string; role?: string; domains?: string[] }, returnTo?: string) => void
      initials: (addr: string) => string
      bytesLabel: (size: number) => string
      formatDate: (iso: string) => string
    }
    _hermesInitialised?: boolean
    _hermesNavInitialised?: boolean
    _hermesInboxRefresh?: () => void
    HERMES_CONFIG?: {
      apiUrl?: string
    }
    __HERMES_DISABLE_SW?: boolean
  }
}

export {}
