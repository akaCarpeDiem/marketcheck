/** Small DOM helpers. The app renders with HTML strings and event delegation. */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape text for use in HTML content or a quoted attribute. */
export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]!);
}

/**
 * Tagged template that escapes every interpolated value. Wrap a value in
 * raw() to insert trusted HTML; arrays are joined.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = strings[0]!;
  for (let i = 0; i < values.length; i++) {
    out += part(values[i]) + strings[i + 1]!;
  }
  return out;
}

class Raw {
  constructor(readonly value: string) {}
}

export function raw(value: string | null | undefined | false): Raw {
  return new Raw(value || '');
}

function part(v: unknown): string {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

const lastHtml = new WeakMap<Element, string>();

/** Set innerHTML only when it changed, so untouched parts keep hover, focus and scroll. */
export function render(el: Element | null | undefined, markup: string): boolean {
  if (!el) return false;
  if (lastHtml.get(el) === markup) return false;
  lastHtml.set(el, markup);
  el.innerHTML = markup;
  return true;
}

export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(sel);
}

export function $$<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] {
  return [...root.querySelectorAll<T>(sel)];
}

/** Delegated listener: runs when the event target is inside an element matching `sel`. */
export function on<K extends keyof HTMLElementEventMap>(
  root: HTMLElement | Document,
  type: K,
  sel: string,
  handler: (ev: HTMLElementEventMap[K], el: HTMLElement) => void,
  opts?: AddEventListenerOptions,
): () => void {
  const listener = (ev: Event) => {
    const target = ev.target as Element | null;
    const el = target?.closest?.(sel) as HTMLElement | null;
    if (el && root.contains(el)) handler(ev as HTMLElementEventMap[K], el);
  };
  root.addEventListener(type, listener, opts);
  return () => root.removeEventListener(type, listener, opts);
}

export const reducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Run a function at most once per animation frame. */
export function frame(fn: () => void): () => void {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fn();
    });
  };
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
