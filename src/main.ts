import './styles/index.css';
import { startMarketData } from './data/market';
import { bootstrap } from './data/user';
import { startVisitTracking } from './data/visit';
import { startRouter, viewForPath, type View, type ViewId } from './router';
import { reportAuthError } from './ui/auth';
import { openFromLocation } from './ui/drawer';
import { startShell } from './ui/shell';
import { heatmapView } from './views/heatmap';
import { marketsView } from './views/markets';
import { newsView } from './views/news';
import { podcastsView } from './views/podcasts';
import { overviewView } from './views/overview';
import { portfolioView } from './views/portfolio';
import { crypto, equities } from './data/market';

const views: Record<ViewId, () => View> = {
  overview: () => overviewView,
  markets: () => marketsView,
  heatmap: () => heatmapView,
  portfolio: () => portfolioView,
  news: () => newsView,
  podcasts: () => podcastsView,
};

function boot(): void {
  const host = document.getElementById('view');
  if (!host) return;
  startShell();
  startMarketData();
  void bootstrap().then(startVisitTracking);

  // Text pages (About, Privacy…) keep their server-written content; the app only runs the frame.
  if (viewForPath(location.pathname)) startRouter(host, views);

  // ?q=SYMBOL opens that asset. Wait for the feeds so the symbol can be recognised.
  if (new URL(location.href).searchParams.get('q')) {
    let opened = false;
    const tryOpen = () => {
      if (opened) return;
      if (crypto.get().status === 'loading' || equities.get().status === 'loading') return;
      opened = true;
      openFromLocation();
    };
    crypto.subscribe(tryOpen);
    equities.subscribe(tryOpen);
    setTimeout(() => {
      if (!opened) {
        opened = true;
        openFromLocation();
      }
    }, 6000);
  }
  window.addEventListener('popstate', () => openFromLocation());
  reportAuthError();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
