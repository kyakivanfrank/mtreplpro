'use client';
import Portal from '@/components/ui/Portal';

import React, { useEffect, useMemo, useState } from 'react';
import SearchIcon from '@/components/icons/Search';
import { useBrokerSymbol } from '@/lib/account';
import { GROUPS, allInstruments, type Instrument } from '@/lib/instruments';
import { usePublished } from '@/lib/market/store';

/**
 * Only what is actually published can be picked.
 *
 * This has swung both ways. It was six hard-coded symbols, then everything the broker
 * offered — which was right while the app fetched history on demand from a terminal that
 * could answer for any instrument.
 *
 * It cannot be right now. The terminal publishes a fixed set on a schedule, so an instrument
 * outside that set has no bars anywhere and never will: picking it adds a row to the
 * watchlist that can only ever say "no data", and the user has no way to tell that apart
 * from something that is merely still downloading.
 *
 * So the list is whatever the catalogue says is published. Until that arrives the picker
 * falls back to the full table rather than showing an empty sheet — a cold launch should
 * look like it is loading, not like the broker offers nothing.
 */

interface SymbolPickerModalProps {
  open: boolean;
  /** Symbol currently occupying the row being replaced, e.g. "EURUSD". */
  targetDisplay: string;
  /** Canonical symbols already on the watchlist, e.g. ["EURUSD", ...]. */
  usedSymbols: string[];
  onSelect: (instrument: Instrument) => void;
  onClose: () => void;
}

export default function SymbolPickerModal({
  open,
  targetDisplay,
  usedSymbols,
  onSelect,
  onClose,
}: SymbolPickerModalProps) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);

  // Rows are matched and selected canonically; only the label carries the account's suffix.
  const toBrokerSymbol = useBrokerSymbol();

  /* ---------- reset navigation each time the sheet opens ---------- */
  useEffect(() => {
    if (open) {
      setQuery('');
      setGroup(null);
    }
  }, [open]);

  const published = usePublished();

  // Recomputed when the sheet opens, so a catalogue that arrived since last time is picked up.
  const instruments = useMemo(() => {
    const all = allInstruments();
    if (published.length === 0) return all; // catalogue has not landed yet

    const offered = new Set(published);
    return all.filter((instrument) => offered.has(instrument.symbol));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, published]);

  const groups = useMemo(
    () =>
      GROUPS.map((name) => ({
        name,
        count: instruments.filter((i) => i.group === name).length,
      })).filter((g) => g.count > 0),
    [instruments]
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();

    // Searching looks across every group; otherwise you're browsing one folder.
    const scope = q ? instruments : group ? instruments.filter((i) => i.group === group) : [];
    if (!q) return scope;

    return scope.filter(
      (i) =>
        i.symbol.toLowerCase().includes(q) ||
        i.base.toLowerCase().includes(q) ||
        i.quote.toLowerCase().includes(q)
    );
  }, [query, group, instruments]);

  if (!open) return null;

  const browsing = Boolean(query.trim()) || group !== null;
  const title = query.trim() ? 'Search' : group ?? 'Symbols';

  return (
    // z-60 so it covers the tab bar (z-50), the way MT5's symbol screen takes the whole screen.
    <Portal>
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white font-sans pt-[var(--safe-top)]">
      {/* Header */}
      <div className="pt-4 pb-4 px-4 flex justify-between items-center relative">
        <div className="flex-1 flex justify-start z-10">
          {group && !query.trim() ? (
            <button
              onClick={() => setGroup(null)}
              className="text-accent text-[17px] flex items-center gap-1"
            >
              <svg width="9" height="14" viewBox="0 0 9 14" fill="none">
                <path d="M7.5 1.5L2 7L7.5 12.5" stroke="#0A84FF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </button>
          ) : (
            <button onClick={onClose} className="text-accent text-[17px]">
              Cancel
            </button>
          )}
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 z-0 flex flex-col justify-center items-center leading-tight">
          <span className="font-semibold text-[17px]">{title}</span>
          <span className="text-[11px] text-muted mt-0.5">
            Replace {toBrokerSymbol(targetDisplay)}
          </span>
        </div>
        <div className="flex-1 flex justify-end z-10" />
      </div>

      <div className="px-4 pb-2">
        {/* Search Bar */}
        <div className="bg-surface rounded-lg flex items-center px-3 py-1.5 mb-2 mt-1">
          <SearchIcon className="w-4 h-4 text-muted mr-2" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="enter symbol for search"
            className="bg-transparent text-white w-full outline-none text-[15px] placeholder-muted"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-muted text-[15px] ml-2 px-1">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {!browsing && (
          <div className="flex flex-col">
            {groups.map((g) => (
              <GroupRow key={g.name} name={g.name} count={g.count} onClick={() => setGroup(g.name)} />
            ))}
          </div>
        )}

        {browsing && (
          <div className="flex flex-col">
            {results.map((instrument) => (
              <SymbolRow
                key={instrument.symbol}
                instrument={instrument}
                label={toBrokerSymbol(instrument.display)}
                inUse={usedSymbols.includes(instrument.symbol)}
                isTarget={instrument.display === targetDisplay}
                onClick={() => onSelect(instrument)}
              />
            ))}

            {results.length === 0 && (
              <div className="px-4 py-10 text-center text-muted text-[13px]">
                No symbols found
              </div>
            )}
          </div>
        )}

        <div className="h-[calc(2.5rem+var(--safe-bottom))] shrink-0 w-full pointer-events-none" />
      </div>
    </div>
    </Portal>
  );
}

function GroupRow({ name, count, onClick }: { name: string; count: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full px-4 text-left active:bg-white/5 transition-colors">
      <div className="flex flex-row justify-between items-center py-2 min-h-[48px] border-b border-hairline">
        <span className="text-white text-[17px] leading-tight">{name}</span>
        <div className="flex items-center">
          <span className="text-muted text-[15px]">{count}</span>
          <svg width="9" height="14" viewBox="0 0 9 14" fill="none" className="ml-2">
            <path d="M2 1.5L7.5 7L2 12.5" stroke="#5c5c5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </button>
  );
}

function SymbolRow({
  instrument,
  label,
  inUse,
  isTarget,
  onClick,
}: {
  instrument: Instrument;
  /** Display name with the account type's suffix — the row never shows the raw one. */
  label: string;
  inUse: boolean;
  isTarget: boolean;
  onClick: () => void;
}) {
  // Already on the watchlist elsewhere — MT5 won't let the same symbol sit in two rows.
  const disabled = inUse && !isTarget;

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full px-4 text-left transition-colors ${disabled ? 'opacity-40' : 'active:bg-white/5'}`}
    >
      <div className="flex flex-row justify-between items-center py-2 min-h-[48px] border-b border-hairline">
        <div className="flex flex-col justify-center">
          <span className="text-white text-[17px] leading-tight">{label}</span>
          <span className="text-muted text-[13px] leading-tight mt-0.5">
            {instrument.base} vs {instrument.quote}
          </span>
        </div>
        {(inUse || isTarget) && (
          <svg width="16" height="12" viewBox="0 0 16 12" fill="none" className="ml-2 shrink-0">
            <path
              d="M1.5 6L5.5 10L14.5 1.5"
              stroke={isTarget ? '#0A84FF' : '#8e8e93'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </button>
  );
}
