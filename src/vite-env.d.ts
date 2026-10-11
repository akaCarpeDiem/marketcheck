/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REFRESH_MS?: string;
  /** Google AdSense client id, e.g. ca-pub-XXXXXXXX. When unset, no live ads load. */
  readonly VITE_ADSENSE_CLIENT?: string;
  /** Optional AdSense ad unit slot id. */
  readonly VITE_ADSENSE_SLOT?: string;
  /**
   * Cloudflare Web Analytics beacon token.
   * Leave unset to rely on CF dashboard Web Analytics (no custom beacon).
   * Do not invent a token.
   */
  readonly VITE_CF_WEB_ANALYTICS_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
