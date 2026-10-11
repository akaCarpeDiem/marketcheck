/** Values injected by scripts/build.mjs (see the top of that file). */
interface ImportMetaEnv {
  readonly DEV: boolean;
  /** Google AdSense publisher id, e.g. ca-pub-XXXXXXXX. */
  readonly VITE_ADSENSE_CLIENT: string;
  /** Optional AdSense ad unit id for the in-page slots. */
  readonly VITE_ADSENSE_SLOT: string;
  /** Optional quote refresh interval override, ms. */
  readonly VITE_REFRESH_MS: string;
  /** Optional Cloudflare Web Analytics beacon token. */
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
declare module '*.css';
