/** Modal layers (dialogs, the search palette, the asset sheet) with focus handling. */

export type Overlay = {
  el: HTMLElement;
  /** The panel inside the backdrop. */
  panel: HTMLElement;
  close(): void;
  isOpen(): boolean;
};

const stack: Overlay[] = [];

function lockScroll(lock: boolean): void {
  const root = document.documentElement;
  if (lock) {
    const gap = window.innerWidth - root.clientWidth;
    root.style.setProperty('--scrollbar-gap', `${gap}px`);
    root.classList.add('is-locked');
  } else {
    root.classList.remove('is-locked');
    root.style.removeProperty('--scrollbar-gap');
  }
}

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
    (el) => el.offsetParent !== null,
  );
}

export function openOverlay(opts: {
  /** Extra class on the backdrop: "sheet", "dialog", "palette". */
  kind: string;
  label: string;
  onClose?: () => void;
  /** Focus this selector on open; otherwise the first focusable element. */
  focus?: string;
}): Overlay {
  const returnTo = document.activeElement as HTMLElement | null;
  const el = document.createElement('div');
  el.className = `overlay overlay-${opts.kind}`;
  const panel = document.createElement('div');
  panel.className = `overlay-panel ${opts.kind}`;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', opts.label);
  panel.tabIndex = -1;
  el.appendChild(panel);
  document.body.appendChild(el);

  let open = true;
  const overlay: Overlay = {
    el,
    panel,
    isOpen: () => open,
    close() {
      if (!open) return;
      open = false;
      const i = stack.indexOf(overlay);
      if (i >= 0) stack.splice(i, 1);
      el.classList.remove('is-in');
      document.removeEventListener('keydown', onKey, true);
      if (!stack.length) lockScroll(false);
      setTimeout(() => el.remove(), 200);
      opts.onClose?.();
      if (returnTo && document.contains(returnTo)) returnTo.focus({ preventScroll: true });
    },
  };

  const onKey = (ev: KeyboardEvent) => {
    if (stack[stack.length - 1] !== overlay) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      overlay.close();
      return;
    }
    if (ev.key !== 'Tab') return;
    const items = focusable(panel);
    if (!items.length) {
      ev.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (ev.shiftKey && (active === first || !panel.contains(active))) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && (active === last || !panel.contains(active))) {
      ev.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKey, true);

  el.addEventListener('mousedown', (ev) => {
    if (ev.target === el) overlay.close();
  });
  panel.addEventListener('click', (ev) => {
    if ((ev.target as Element).closest?.('[data-close]')) overlay.close();
  });

  stack.push(overlay);
  lockScroll(true);
  requestAnimationFrame(() => {
    el.classList.add('is-in');
    const target = (opts.focus && panel.querySelector<HTMLElement>(opts.focus)) || focusable(panel)[0] || panel;
    target.focus({ preventScroll: true });
  });
  return overlay;
}

export const anyOverlayOpen = (): boolean => stack.length > 0;
