/** The overview: the whole market on one page, with the visitor's own things up top. */
import { Scope } from '../lib/store';
import type { View } from '../router';
import { adSlot, pushAds } from '../ui/ads';
import { mountBestBuys } from './parts/bestbuys';
import { mountBrief } from './parts/brief';
import { mountGame } from './parts/game';
import { mountMovers } from './parts/movers';
import { mountPulse } from './parts/pulse';
import { mountTables } from './parts/tables';
import { mountTiles } from './parts/tiles';

export const overviewView: View = {
  mount(el) {
    const scope = new Scope();
    el.innerHTML = `
      <h1 class="sr-only">Market Check: live market overview</h1>
      <section class="ov-top">
        <div class="card brief" id="ov-brief"></div>
        <div class="card day" id="ov-day"></div>
      </section>

      <section aria-label="Key markets">
        <div class="section-title"><h2>Key markets</h2><p>Crypto, metals, oil and the main US indexes</p></div>
        <div class="tiles tiles-hero" id="ov-hero"></div>
      </section>

      <section class="card best" id="ov-best" aria-label="Yesterday’s best buys"></section>

      <section class="pulse" id="ov-pulse" aria-label="Market pulse"></section>

      <section class="ov-tables">
        <div class="card" id="ov-crypto"></div>
        <div class="card" id="ov-equity"></div>
      </section>

      <section aria-label="Indexes and funds">
        <div class="section-title"><h2>Indexes and funds</h2><p>Benchmarks, bonds, real estate, chips and metals</p></div>
        <div class="tiles tiles-index" id="ov-index"></div>
      </section>

      <section class="card call" id="ov-call" aria-label="Daily call"></section>

      <section class="ov-movers">
        <div class="card panel" id="ov-left"></div>
        <div class="card panel" id="ov-right"></div>
        <div class="card bubble-card" id="ov-bubbles"></div>
      </section>

      ${adSlot('overview-mid')}

      ${adSlot('overview-foot')}
    `;
    const $ = (id: string) => el.querySelector<HTMLElement>(`#${id}`)!;
    mountBrief($('ov-brief'), $('ov-day'), scope);
    mountTiles($('ov-hero'), $('ov-index'), scope);
    mountBestBuys($('ov-best'), scope);
    mountPulse($('ov-pulse'), scope);
    mountTables($('ov-crypto'), $('ov-equity'), scope);
    mountGame($('ov-call'), scope);
    mountMovers($('ov-left'), $('ov-right'), $('ov-bubbles'), scope);
    pushAds(el);
    return () => scope.dispose();
  },
};
