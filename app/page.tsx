"use client";

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import SettingsView from '@/components/settings/SettingsView';
import HistoryView from '@/components/history/HistoryView';
import TradeView from '@/components/trade/TradeView';
import QuotesView from '@/components/quotes/QuotesView';
import ChartView, { DEFAULT_CHART_SYMBOL } from '@/components/chart/ChartView';
import BottomNav from '@/components/ui/BottomNav';
import { tradingStore } from '@/lib/trading/store';
import { STORAGE_KEYS, scopedKey, usePersistentState } from '@/lib/storage';
import { useAccountScope } from '@/lib/account';
import { useAuth } from '@/lib/auth/client';
import { normalizeSymbol } from '@/lib/instruments';
import LoginWall from '@/components/ui/LoginWall';

export default function Home() {
  const [activeTab, setActiveTab] = useState('settings');
  // Remembered across launches, like the terminal reopening on your last instrument.
  // Each account is left on its own instrument, and comes back to it.
  const scope = useAccountScope();
  const [chartSymbol, setChartSymbol] = usePersistentState(
    scopedKey(STORAGE_KEYS.chartSymbol, scope),
    DEFAULT_CHART_SYMBOL
  );
  const { state: auth, submit } = useAuth();

  /** Long-pressing a watchlist row loads that instrument and jumps to the chart. */
  const openChart = (symbol: string) => {
    setChartSymbol(symbol);
    setActiveTab('chart');
  };

  /**
   * Bring the account back before anything is rendered against it.
   *
   * The playback session restores itself from storage on the market store's own start, always
   * paused — returning to the app never means discovering it traded on without you.
   */
  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    tradingStore.init();
  }, [auth.status]);

  // Nothing renders until the session is known, so the terminal never flashes behind the gate.
  if (auth.status === 'loading') {
    return <div className="h-[100dvh] bg-black" />;
  }

  if (auth.status === 'anonymous') {
    return <LoginWall onSubmit={submit} />;
  }

  return (
    <div className="relative h-full bg-black text-white font-sans overflow-hidden">

      {/*
        Content Area.

        The safe-area padding lives HERE and not on the shell above: this element is
        absolutely positioned, and `inset-0` resolves against the shell's padding box, so
        padding applied up there would be silently ignored and the header would sit under
        the notch / Dynamic Island in standalone.
      */}
      <div className="absolute bg-black inset-0 pt-[var(--safe-top)]">
        {activeTab === 'settings' && <SettingsView />}
        {activeTab === 'history' && <HistoryView />}
        {activeTab === 'trade' && <TradeView />}
        {activeTab === 'quotes' && <QuotesView onOpenChart={openChart} />}
        {activeTab === 'chart' && <ChartView symbol={normalizeSymbol(chartSymbol)} />}
      </div>

      {/*
        iOS 26 draws a Liquid Glass blur ~40pt down from the top of an installed web app, over
        whatever is there -- it was softening every header title and button. WebKit skips it
        when a fixed, full-width box at the top edge paints one solid colour, so this band
        (black, as the real terminal's status area is) is that box.
      */}
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[55] h-[var(--safe-top)] bg-black" />

      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
