/** Dark / light theme. Dark is the default; the choice is remembered in this browser. */
import { readText, writeText } from '../lib/storage';
import { signal } from '../lib/store';

export type Theme = 'dark' | 'light';

function initial(): Theme {
  const saved = readText('mc-theme');
  if (saved === 'light' || saved === 'dark') return saved;
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export const theme = signal<Theme>(initial());

export function setTheme(next: Theme): void {
  document.documentElement.dataset.theme = next;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'light' ? '#f3f5f9' : '#080a0f');
  writeText('mc-theme', next);
  theme.set(next);
}

export const toggleTheme = (): void => setTheme(theme.get() === 'dark' ? 'light' : 'dark');

/** Read a CSS custom property's current value (canvas drawing needs real colours). */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
