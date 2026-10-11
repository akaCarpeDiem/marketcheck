/** The small form for adding or editing a portfolio holding. */
import { lookup, priceText, type AssetRef } from '../data/assets';
import { addHolding, data, removeHolding, updateHolding } from '../data/user';
import { html, raw } from '../lib/dom';
import { money, quantity } from '../lib/format';
import { icon } from '../lib/icons';
import { openOverlay } from './overlay';
import { toast } from './toast';

/** "1,250.5" or "$12.40" -> a number, or null. */
function parseAmount(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function openHoldingForm(ref: AssetRef): void {
  const existing = data.get().holdings.find((h) => h.ref.key === ref.key) ?? null;
  const p = lookup(ref);
  const o = openOverlay({ kind: 'dialog', label: existing ? `Edit ${ref.sym} holding` : `Add ${ref.sym} to portfolio`, focus: 'input[name="qty"]' });
  o.panel.classList.add('holding-form');

  const paint = (error = '') => {
    o.panel.innerHTML = html`<button type="button" class="icon-btn overlay-x" data-close aria-label="Close">${raw(icon.close(16))}</button>
      <h2>${existing ? 'Edit holding' : 'Add to portfolio'}</h2>
      <p class="muted">${ref.name} (${ref.sym}) · now ${priceText(ref, p.price)}</p>
      <form novalidate>
        <label class="field">
          <span class="field-label">How many do you hold?</span>
          <input class="input num" name="qty" inputmode="decimal" autocomplete="off" placeholder="e.g. 10 or 0.25" value="${existing ? String(existing.qty) : ''}" />
        </label>
        <label class="field">
          <span class="field-label">Average price paid, each <em>(optional)</em></span>
          <input class="input num" name="cost" inputmode="decimal" autocomplete="off" placeholder="${p.price != null ? `e.g. ${p.price < 1 ? p.price.toPrecision(3) : p.price.toFixed(2)}` : 'e.g. 120.50'}" value="${existing?.cost != null ? String(existing.cost) : ''}" />
          <span class="field-hint">Used to show your profit or loss. Leave empty to track value only.</span>
        </label>
        ${raw(error ? html`<p class="auth-note is-bad" role="alert">${error}</p>` : '')}
        <div class="form-actions">
          ${raw(existing ? `<button type="button" class="btn btn-ghost btn-danger" data-remove>${icon.trash(15)} Remove</button>` : '')}
          <span class="grow"></span>
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn btn-primary">${existing ? 'Save' : 'Add'}</button>
        </div>
      </form>
      <p class="faint form-foot">Kept ${existing || data.get().holdings.length ? '' : 'only '}in this browser, or with your account when you are signed in. Nothing is bought or sold here.</p>`;
  };
  paint();

  o.panel.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target as HTMLFormElement);
    const qty = parseAmount(String(fd.get('qty') ?? ''));
    const costText = String(fd.get('cost') ?? '').trim();
    const cost = costText ? parseAmount(costText) : null;
    if (qty == null || qty <= 0) {
      paint('Enter how many you hold, as a number above zero.');
      o.panel.querySelector<HTMLInputElement>('input[name="qty"]')?.focus();
      return;
    }
    if (costText && (cost == null || cost < 0)) {
      paint('Enter the price paid as a number, or leave it empty.');
      o.panel.querySelector<HTMLInputElement>('input[name="cost"]')?.focus();
      return;
    }
    if (existing) {
      updateHolding(existing.id, qty, cost);
      toast(`${ref.sym} holding updated.`, 'good');
    } else if (addHolding(ref, qty, cost)) {
      const worth = p.price != null ? ` (${money(qty * p.price)})` : '';
      toast(`Added ${quantity(qty)} ${ref.sym}${worth} to your portfolio.`, 'good');
    } else {
      paint('Your portfolio is full. Remove a holding first.');
      return;
    }
    o.close();
  });
  o.panel.addEventListener('click', (ev) => {
    if ((ev.target as Element).closest('[data-remove]') && existing) {
      removeHolding(existing.id);
      toast(`${ref.sym} removed from your portfolio.`);
      o.close();
    }
  });
}
