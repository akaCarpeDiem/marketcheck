/**
 * Briefly tint a price when it changes. Mark an element with
 * data-flash="<key>" and data-v="<number>"; call flash(root) after each render.
 */
const seen = new WeakMap<Element, Map<string, number>>();

export function flash(root: Element | null | undefined): void {
  if (!root) return;
  let prev = seen.get(root);
  const first = !prev;
  if (!prev) {
    prev = new Map();
    seen.set(root, prev);
  }
  const next = new Map<string, number>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-flash][data-v]')) {
    const key = el.dataset.flash!;
    const text = el.dataset.v ?? '';
    const v = text === '' ? NaN : Number(text);
    if (!Number.isFinite(v)) continue;
    next.set(key, v);
    const before = prev.get(key);
    if (first || before == null || before === v) continue;
    // Two sources can round the same price differently; that is not a move.
    if (Math.abs(v - before) <= Math.abs(before) * 1e-6) continue;
    const cls = v > before ? 'flash-up' : 'flash-down';
    el.classList.remove('flash-up', 'flash-down');
    // Restart the animation if the element is reused.
    void el.offsetWidth;
    el.classList.add(cls);
  }
  seen.set(root, next);
}
