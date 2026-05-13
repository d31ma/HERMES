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
      toastAction: (msg: string, action: { label: string; onClick: () => void }, duration?: number) => void
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
    _hermesShowToast?: (msg: string | { msg: string; duration?: number; action?: { label: string; onClick: () => void } }, duration?: number) => void
    _hermesKeyboard?: {
      init: () => Promise<void>
      destroy: () => void
    }
    HERMES_CONFIG?: {
      apiUrl?: string
    }
    __HERMES_DISABLE_SW?: boolean
    Tac?: {
      modules: Map<string, unknown>
      register: (name: string, module: unknown) => unknown
      load: (name: string) => Promise<unknown>
      navigate: (path: string) => void
      rerender: (id: string, detail?: unknown) => Promise<void>
      provide: (key: string, value: unknown) => void
    }
  }

  /** Base class for Tachyon components and page companions */
  class Tac {
    /** Reactive state fields (prefixed with $) */
    [key: string]: unknown

    /** Props passed from parent component or route */
    props: Record<string, unknown>

    /** Tachyon framework helpers */
    tac: {
      isBrowser: boolean
      isServer: boolean
      onMount: (fn: () => void) => void
      emit: (name: string, detail?: unknown) => boolean
      rerender: () => void
      inject: <T>(key: string, fallback?: T) => T | undefined
      provide: (key: string, value: unknown) => void
      env: <T>(key: string, fallback?: T) => T | undefined
      fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
      bindPersistentFields: (ctrl: unknown) => void
    }

    /** Emit a custom event from this component */
    emit(name: string, detail?: unknown): boolean
  }
}

export {}
