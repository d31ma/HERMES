/**
 * HERMES runtime configuration module.
 *
 * Sets the minimal global configuration object on `window.HERMES_CONFIG`
 * so every page and component can read API endpoints and other runtime
 * settings without an extra fetch. The object is intended to be enriched
 * at build time or by a server-side template.
 *
 * @module config
 */

/** @type {{ apiUrl: string }} */
window.HERMES_CONFIG = { apiUrl: '' };
