/** Inline SVG icons (16px grid, stroke = currentColor). */

const svg = (body: string, size = 16, extra = ''): string =>
  `<svg class="ico" viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const icon = {
  search: (s = 16) => svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>', s),
  star: (s = 16) => svg('<path d="m8 1.8 1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"/>', s),
  starFill: (s = 16) =>
    `<svg class="ico" viewBox="0 0 16 16" width="${s}" height="${s}" fill="currentColor" aria-hidden="true"><path d="m8 1.3 2.1 4.2 4.6.7-3.3 3.3.8 4.6L8 11.9l-4.2 2.2.8-4.6L1.3 6.2l4.6-.7z"/></svg>`,
  sun: (s = 16) =>
    svg('<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>', s),
  moon: (s = 16) => svg('<path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8z"/>', s),
  user: (s = 16) => svg('<circle cx="8" cy="5.6" r="2.6"/><path d="M2.8 13.6c.6-2.4 2.7-3.8 5.2-3.8s4.6 1.4 5.2 3.8"/>', s),
  close: (s = 16) => svg('<path d="m3.5 3.5 9 9M12.5 3.5l-9 9"/>', s),
  edit: (s = 16) => svg('<path d="m10.8 2.6 2.6 2.6-7.6 7.6-3.2.6.6-3.2z"/><path d="m9.4 4 2.6 2.6"/>', s),
  plus: (s = 16) => svg('<path d="M8 3v10M3 8h10"/>', s),
  minus: (s = 16) => svg('<path d="M3 8h10"/>', s),
  check: (s = 16) => svg('<path d="m3 8.4 3.2 3.2L13 4.8"/>', s),
  chevronRight: (s = 16) => svg('<path d="m6 3.5 4.5 4.5L6 12.5"/>', s),
  chevronLeft: (s = 16) => svg('<path d="M10 3.5 5.5 8l4.5 4.5"/>', s),
  chevronDown: (s = 16) => svg('<path d="m3.5 6 4.5 4.5L12.5 6"/>', s),
  external: (s = 16) => svg('<path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3"/>', s),
  link: (s = 16) => svg('<path d="M6.8 9.2a3 3 0 0 0 4.2 0l2.1-2.1a3 3 0 0 0-4.2-4.2l-.9.9"/><path d="M9.2 6.8a3 3 0 0 0-4.2 0L2.9 8.9a3 3 0 0 0 4.2 4.2l.9-.9"/>', s),
  trash: (s = 16) => svg('<path d="M2.5 4.2h11M6.2 4.2V2.8h3.6v1.4M4 4.2l.6 8.6a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.6M6.6 6.8v4.2M9.4 6.8v4.2"/>', s),
  clock: (s = 16) => svg('<circle cx="8" cy="8" r="5.8"/><path d="M8 4.8V8l2.2 1.4"/>', s),
  info: (s = 16) => svg('<circle cx="8" cy="8" r="5.8"/><path d="M8 7.2v3.6M8 5.1v.1"/>', s),
  refresh: (s = 16) => svg('<path d="M13.3 8a5.3 5.3 0 0 1-9.6 3.1M2.7 8a5.3 5.3 0 0 1 9.6-3.1"/><path d="M12.6 2.2v2.9H9.7M3.4 13.8v-2.9h2.9"/>', s),
  play: (s = 16) =>
    `<svg class="ico" viewBox="0 0 16 16" width="${s}" height="${s}" fill="currentColor" aria-hidden="true"><path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.6-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5z"/></svg>`,
  arrowUp: (s = 16) => svg('<path d="M8 12.8V3.2M4 7.2l4-4 4 4"/>', s),
  arrowDown: (s = 16) => svg('<path d="M8 3.2v9.6M4 8.8l4 4 4-4"/>', s),
  grid: (s = 16) => svg('<rect x="2.2" y="2.2" width="4.6" height="4.6" rx="1"/><rect x="9.2" y="2.2" width="4.6" height="4.6" rx="1"/><rect x="2.2" y="9.2" width="4.6" height="4.6" rx="1"/><rect x="9.2" y="9.2" width="4.6" height="4.6" rx="1"/>', s),
  list: (s = 16) => svg('<path d="M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.1M2.5 8h.1M2.5 12h.1"/>', s),
  bubbles: (s = 16) => svg('<circle cx="5.6" cy="6" r="3.6"/><circle cx="11.6" cy="10.6" r="2.6"/><circle cx="11.8" cy="4" r="1.5"/>', s),
  treemap: (s = 16) => svg('<rect x="2" y="2.5" width="12" height="11" rx="1.4"/><path d="M8.6 2.5v11M8.6 8h5.4M2 9.4h6.6"/>', s),
  wallet: (s = 16) => svg('<path d="M2.5 5.2a1.7 1.7 0 0 1 1.7-1.7h7.1v2.2"/><rect x="2.5" y="5.2" width="11" height="8" rx="1.6"/><path d="M11 9.2h.1"/>', s),
  news: (s = 16) => svg('<rect x="2.3" y="3" width="11.4" height="10" rx="1.4"/><path d="M5 6h6M5 8.4h6M5 10.8h3.4"/>', s),
  home: (s = 16) => svg('<path d="M2.5 7.4 8 2.8l5.5 4.6v5.3a.9.9 0 0 1-.9.9H9.9V9.8H6.1v3.8H3.4a.9.9 0 0 1-.9-.9z"/>', s),
  chart: (s = 16) => svg('<path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5"/>', s),
  trophy: (s = 16) => svg('<path d="M5 2.5h6v3.2a3 3 0 0 1-6 0V2.5zM5 3.6H2.8c0 2 .9 3.2 2.4 3.4M11 3.6h2.2c0 2-.9 3.2-2.4 3.4M8 8.7v2.6M5.6 13.5h4.8M6.4 11.3h3.2"/>', s),
  flame: (s = 16) => svg('<path d="M8 14c2.6 0 4.4-1.8 4.4-4.3 0-2.2-1.4-3.5-2.4-5.1C9.3 3.3 9.2 2.4 9.2 2c-2 1-3.2 3-3 5.1C5.3 6.8 4.9 6.1 4.8 5.4 3.9 6.6 3.6 8 3.6 9.7 3.6 12.2 5.4 14 8 14z"/>', s),
  logout: (s = 16) => svg('<path d="M6.4 13.5H3.6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h2.8M10.2 11 13.3 8l-3.1-3M13.2 8H6.2"/>', s),
  bell: (s = 16) => svg('<path d="M4 11.2V7.4a4 4 0 0 1 8 0v3.8l1.2 1.3H2.8zM6.6 13.8a1.5 1.5 0 0 0 2.8 0"/>', s),
  calendar: (s = 16) => svg('<rect x="2.3" y="3.3" width="11.4" height="10.2" rx="1.5"/><path d="M2.3 6.6h11.4M5.3 2v2.4M10.7 2v2.4"/>', s),
  drag: (s = 16) => svg('<path d="M6 3.5h.1M6 8h.1M6 12.5h.1M10 3.5h.1M10 8h.1M10 12.5h.1"/>', s, 'stroke-width="2.2"'),
  eye: (s = 16) => svg('<path d="M1.8 8S4.1 3.8 8 3.8 14.2 8 14.2 8 11.9 12.2 8 12.2 1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.9"/>', s),
  eyeOff: (s = 16) => svg('<path d="M2.2 2.2l11.6 11.6M6.5 4a6 6 0 0 1 1.5-.200c3.9 0 6.2 4.2 6.2 4.2a11 11 0 0 1-1.9 2.4M10 10.9a4.9 4.9 0 0 1-2 .500C4.1 11.4 1.8 8 1.8 8a11 11 0 0 1 2.5-2.9"/>', s),
  share: (s = 16) => svg('<path d="M8 10V2.4M5.2 5 8 2.2 10.8 5M3 8.6v3.8a1.2 1.2 0 0 0 1.2 1.2h7.6a1.2 1.2 0 0 0 1.2-1.2V8.6"/>', s),
  filter: (s = 16) => svg('<path d="M2.4 3.6h11.2L9.4 8.6v3.8l-2.8 1.2V8.6z"/>', s),
  sort: (s = 16) => svg('<path d="M5 3v10M2.6 10.6 5 13l2.4-2.4M11 13V3M8.6 5.4 11 3l2.4 2.4"/>', s),
  globe: (s = 16) => svg('<circle cx="8" cy="8" r="5.8"/><path d="M2.2 8h11.6M8 2.2c1.8 1.6 2.6 3.6 2.6 5.8S9.8 12.2 8 13.8C6.2 12.2 5.4 10.2 5.4 8S6.2 3.8 8 2.2z"/>', s),
  bolt: (s = 16) => svg('<path d="M9 1.8 3.6 9.2h3.8L6.8 14.2l5.6-7.4H8.6z"/>', s),
  target: (s = 16) => svg('<circle cx="8" cy="8" r="5.8"/><circle cx="8" cy="8" r="2.6"/><path d="M8 8h.1"/>', s),
};

/** Brand marks for sign-in buttons. */
export const GOOGLE_MARK =
  '<svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg>';

export const MICROSOFT_MARK =
  '<svg viewBox="0 0 18 18" width="16" height="16" aria-hidden="true"><rect x="1" y="1" width="7.5" height="7.5" fill="#F25022"/><rect x="9.5" y="1" width="7.5" height="7.5" fill="#7FBA00"/><rect x="1" y="9.5" width="7.5" height="7.5" fill="#00A4EF"/><rect x="9.5" y="9.5" width="7.5" height="7.5" fill="#FFB900"/></svg>';

/**
 * The Market Check mark: a magnifying glass over a run of candles that falls
 * and then climbs out through the gap in the ring. Traced from the brand
 * artwork (ring centre, radii, gap angles and every candle measured from the
 * original), in the brand's own colours so it reads the same in both themes.
 */
export function logoMark(size = 28): string {
  const w = Math.round((size * 860) / 925);
  return `<svg class="logo-mark" viewBox="280 204 860 925" width="${w}" height="${size}" fill="none" aria-hidden="true">
  <defs><linearGradient id="mc-ring" x1="330" y1="330" x2="930" y2="930" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#01bfdd"/><stop offset=".55" stop-color="#00b2d3"/><stop offset="1" stop-color="#008cb0"/></linearGradient><clipPath id="mc-cut"><path clip-rule="evenodd" d="M280 204h860v925h-860ZM800 560h260v201.5h-260Z"/></clipPath></defs>
  <path d="M866.6 456.8A296.25 296.25 0 1 0 908.6 729.4" stroke="url(#mc-ring)" stroke-width="80.5" clip-path="url(#mc-cut)"/>
  <g transform="translate(626.7 634.8) rotate(45)"><rect x="330" y="-38.5" width="70" height="77" fill="#0098bd"/><path d="M394-54H601a54 54 0 0 1 0 108H394q-16 0-16-16V-38q0-16 16-16Z" fill="#00a7cb"/></g>
  <rect x="510" y="432" width="14" height="296" rx="2" fill="#e11420"/><rect x="485.5" y="482" width="63" height="200" rx="4" fill="#e11420"/><rect x="598" y="563" width="14" height="248" rx="2" fill="#e11420"/><rect x="573.5" y="604" width="63" height="167" rx="4" fill="#e11420"/><rect x="679.5" y="690" width="14" height="166" rx="2" fill="#e11420"/><rect x="655" y="729" width="63" height="86" rx="4" fill="#e11420"/><rect x="758.5" y="616" width="14" height="181" rx="2" fill="#339c4a"/><rect x="734" y="654" width="63" height="111" rx="4" fill="#339c4a"/><rect x="838.5" y="525" width="14" height="219" rx="2" fill="#339c4a"/><rect x="814" y="566" width="63" height="136" rx="4" fill="#339c4a"/><rect x="918" y="414" width="14" height="277" rx="2" fill="#339c4a"/><rect x="893.5" y="468" width="63" height="173" rx="4" fill="#339c4a"/><rect x="1001.5" y="314" width="14" height="293" rx="2" fill="#339c4a"/><rect x="977" y="365" width="63" height="190" rx="4" fill="#339c4a"/><rect x="1088.5" y="216" width="14" height="302" rx="2" fill="#339c4a"/><rect x="1064" y="269" width="63" height="193" rx="4" fill="#339c4a"/>
</svg>`;
}
