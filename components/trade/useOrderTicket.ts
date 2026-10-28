import { useEffect, useMemo, useState } from 'react';
import { findInstrument } from '@/lib/instruments';
import { useQuotes } from '@/lib/market/store';
import { useTrading } from '@/lib/trading/store';
import { defaultVolume } from '@/lib/trading/math';
import type { OrderKind } from '@/lib/trading/types';
import type { LevelField } from '@/components/chart/chartConfig';

/** The ticket's fields, the rules that seed them, and what Place does. */
export function useOrderTicket({
  open,
  symbol,
  picked,
  onClose,
}: {
  open: boolean;
  symbol: string;
  picked?: { field: LevelField; price: number; seq: number } | null;
  onClose: () => void;
}) {
  const instrument = findInstrument(symbol);
  const digits = instrument?.digits ?? 5;
  const point = 10 ** -digits;

  const symbols = useMemo(() => [symbol], [symbol]);
  const quotes = useQuotes(symbols);
  const quote = quotes[symbol];

  const { place } = useTrading();

  const [kind, setKind] = useState<OrderKind>('market');
  const [typeOpen, setTypeOpen] = useState(false);
  const [volume, setVolume] = useState(() => defaultVolume(symbol));
  const [price, setPrice] = useState('');
  const [sl, setSl] = useState('');
  const [tp, setTp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const isPending = kind !== 'market';

  // Reopening starts clean, never on the last ticket's leftovers.
  useEffect(() => {
    if (!open) return;
    setKind('market');
    setTypeOpen(false);
    // The smallest size this instrument trades in, not a global 0.01. On XRP that is a whole lot,
    // and opening on a size the broker would refuse means the first thing the user does is fix a
    // number they did not choose.
    setVolume(defaultVolume(symbol));
    setPrice('');
    setSl('');
    setTp('');
    setError(null);
    setDone(null);
  }, [open, symbol]);

  /**
   * Seed the trigger price the moment a pending type is chosen.
   *
   * A blank price field on a limit order is a dead end — the user has no idea what a valid level
   * looks like — so it is pre-filled 20 points on the correct side of the market, which always
   * passes the engine's stops-level check.
   */
  useEffect(() => {
    if (!isPending || !quote) return;

    const offset = 20 * point;
    const seeded =
      kind === 'buy limit'
        ? quote.ask - offset
        : kind === 'sell limit'
          ? quote.bid + offset
          : kind === 'buy stop'
            ? quote.ask + offset
            : quote.bid - offset;

    setPrice(seeded.toFixed(digits));
    // Only when the *type* changes — retyping the price must not be undone by a tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, isPending, digits]);

  /** Apply whatever came back from the chart's crosshair. */
  useEffect(() => {
    if (!picked) return;
    const value = picked.price.toFixed(digits);
    if (picked.field === 'price') setPrice(value);
    else if (picked.field === 'sl') setSl(value);
    else setTp(value);
  }, [picked, digits]);

  const parse = (value: string): number | null => {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  };

  const submit = (side?: 'buy' | 'sell') => {
    setError(null);

    const result = place({
      symbol,
      kind,
      side,
      volume,
      price: isPending ? parse(price) ?? undefined : undefined,
      sl: parse(sl),
      tp: parse(tp),
      // The quote this sheet is showing. A market order fills on it rather than on whatever
      // arrived while the user was choosing a volume.
      at: quote ? { bid: quote.bid, ask: quote.ask } : undefined,
    });

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setDone(`#${result.ticket} placed`);
    // Long enough to read the confirmation, short enough not to feel stuck.
    setTimeout(onClose, 700);
  };

  const selectKind = (next: OrderKind) => {
    setKind(next);
    setTypeOpen(false);
    setError(null);
  };

  return {
    instrument,
    digits,
    point,
    quote,
    kind,
    isPending,
    typeOpen,
    setTypeOpen,
    selectKind,
    volume,
    setVolume,
    price,
    setPrice,
    sl,
    setSl,
    tp,
    setTp,
    error,
    done,
    submit,
  };
}
