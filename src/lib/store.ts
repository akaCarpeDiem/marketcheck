/** A value that tells its listeners when it changes. */
export type Signal<T> = {
  get(): T;
  set(next: T): void;
  /** Change the value in place (or return a new one) and notify. */
  update(fn: (current: T) => T | void): void;
  /** Listen for changes. Returns a function that stops listening. */
  subscribe(fn: (value: T) => void): () => void;
};

export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const listeners = new Set<(value: T) => void>();
  const notify = () => {
    for (const fn of [...listeners]) {
      try {
        fn(value);
      } catch (e) {
        console.error(e);
      }
    }
  };
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      notify();
    },
    update(fn) {
      const next = fn(value);
      if (next !== undefined) value = next as T;
      notify();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/**
 * Collects subscriptions and other clean-up work for a view so it can all be
 * undone when the view goes away.
 */
export class Scope {
  private jobs: Array<() => void> = [];
  add(...fns: Array<(() => void) | undefined | null>): void {
    for (const fn of fns) if (fn) this.jobs.push(fn);
  }
  /** Subscribe and call once now. */
  watch<T>(sig: Signal<T>, fn: (value: T) => void): void {
    this.add(sig.subscribe(fn));
    fn(sig.get());
  }
  listen<K extends keyof WindowEventMap>(type: K, fn: (ev: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void {
    window.addEventListener(type, fn, opts);
    this.add(() => window.removeEventListener(type, fn, opts));
  }
  interval(fn: () => void, ms: number): void {
    const id = setInterval(fn, ms);
    this.add(() => clearInterval(id));
  }
  dispose(): void {
    for (const fn of this.jobs.splice(0)) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
  }
}
