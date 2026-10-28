import React from 'react';
import Section from '@/components/settings/fields/Section';
import ReadoutRow from '@/components/settings/fields/ReadoutRow';
import ChevronRightIcon from '@/components/icons/ChevronRight';
import { brokerSymbol, type AccountConfig } from '@/lib/account';

interface SuffixOption {
  value: string;
  label: string;
  note: string;
}

/** How instruments are labelled across the app. Does not change which market data is loaded. */
export default function AccountTypeSection({
  draft,
  selectedOption,
  suffixOptions,
  open,
  onToggleOpen,
  customSuffix,
  onCustomSuffixChange,
  onAddCustomSuffix,
  onRemoveCustomSuffix,
  onSelectSuffix,
}: {
  draft: AccountConfig;
  selectedOption: SuffixOption;
  suffixOptions: SuffixOption[];
  open: boolean;
  onToggleOpen: () => void;
  customSuffix: string;
  onCustomSuffixChange: (value: string) => void;
  onAddCustomSuffix: () => void;
  onRemoveCustomSuffix: (value: string) => void;
  onSelectSuffix: (value: string) => void;
}) {
  const commitCustom = () => {
    onAddCustomSuffix();
    onToggleOpen();
  };

  return (
    <Section
      title="Account Type"
      footer="Sets how instruments are labelled on the chart, trade and history screens. It does not change which market data is loaded."
    >
      <div className="relative">
        <button
          onClick={onToggleOpen}
          className="w-full flex items-center justify-between py-2 min-h-[48px] text-left"
        >
          <span className="text-white text-[17px]">Type</span>
          <div className="flex items-center gap-2">
            <span className="text-muted text-[17px]">{selectedOption.label}</span>
            <ChevronRightIcon className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          </div>
        </button>

        {open && (
          // Scrolls rather than growing: the list is open-ended as suffixes are added.
          <div className="absolute top-full right-0 z-10 mt-1 min-w-[220px] max-h-[240px] overflow-y-auto bg-surface-2 rounded-[10px] border border-white/10 shadow-xl">
            {/* Anything the broker calls it that isn't listed — typed and selected in one go. */}
            <div className="flex items-center gap-2 px-3 py-2 border-t border-white/10">
              <input
                value={customSuffix}
                onChange={(e) => onCustomSuffixChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !customSuffix.trim()) return;
                  commitCustom();
                }}
                placeholder="Custom suffix"
                className="flex-1 min-w-0 bg-transparent text-white outline-none text-[15px] placeholder-muted"
              />
              <button
                onClick={commitCustom}
                disabled={!customSuffix.trim()}
                className={`shrink-0 text-[13px] px-2.5 py-1 rounded-[8px] transition-colors ${
                  customSuffix.trim() ? 'text-white bg-accent' : 'text-faint bg-surface-3'
                }`}
              >
                Use
              </button>
            </div>

            {suffixOptions.map((option) => (
              <div
                key={option.value || 'standard'}
                className={`flex items-center ${draft.symbolSuffix === option.value ? 'bg-white/5' : ''}`}
              >
                <button
                  onClick={() => onSelectSuffix(option.value)}
                  className="flex-1 min-w-0 flex items-center justify-between gap-4 px-3 py-2.5 text-left transition-colors active:bg-white/5"
                >
                  <span className="text-white text-[15px] truncate">{option.label}</span>
                  <span className="text-muted text-[13px] font-mono shrink-0">
                    {brokerSymbol('XAUUSD', { ...draft, symbolSuffix: option.value })}
                  </span>
                </button>
                {draft.customSuffixes.includes(option.value) && (
                  <button
                    onClick={() => onRemoveCustomSuffix(option.value)}
                    className="text-danger text-[13px] pl-2 pr-3 py-2.5 shrink-0"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ReadoutRow
        size="sm"
        label="Preview"
        divider="top"
        tabular={false}
        valueClassName="text-white font-mono"
        value={brokerSymbol('XAUUSD', draft)}
      />
    </Section>
  );
}
