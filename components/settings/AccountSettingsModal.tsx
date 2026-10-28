'use client';

import React from 'react';
import Portal from '@/components/ui/Portal';
import AccountTypeSection from '@/components/settings/sections/AccountTypeSection';
import AutoTradingSection from '@/components/settings/sections/AutoTradingSection';
import FundsSection from '@/components/settings/sections/FundsSection';
import {
  BrokerSection,
  LedgerSection,
  TradeCommentSection,
} from '@/components/settings/sections/IdentitySections';
import {
  LocalDataSection,
  MarketDataSection,
} from '@/components/settings/sections/DataSections';
import { useAccountDraft } from '@/components/settings/useAccountDraft';
import type { AccountConfig } from '@/lib/account';
import { archiveCandles, archiveDays } from '@/lib/market/archive';
import { usePublished } from '@/lib/market/store';

interface AccountSettingsModalProps {
  open: boolean;
  config: AccountConfig;
  onClose: () => void;
}

/**
 * Editor for the account, broker and instrument-naming settings.
 *
 * Arrangement only: the draft, the save rules and the reset live in `./useAccountDraft`, each
 * block in `./sections`, and the row primitives they share in `./fields`.
 */
export default function AccountSettingsModal({ open, config, onClose }: AccountSettingsModalProps) {
  const d = useAccountDraft(open, config, onClose);

  const publishedCandles = archiveCandles();
  const publishedDays = archiveDays();
  const publishedCount = usePublished().length;

  // ~24 bytes a candle packed: one timestamp and four scaled prices.
  const perSymbolBytes = publishedCandles * 24;

  if (!open) return null;

  return (
    // Portalled, so z-[70] is measured against the app rather than against the pane it is
    // written in — see components/ui/Portal.tsx. It clears the tab bar (50) and the symbol
    // picker (60), and sits below the login wall (90).
    <Portal>
      <div className="fixed inset-0 z-[70] flex flex-col bg-black text-white font-sans pt-[var(--safe-top)]">
        {/* Header */}
        <div className="pt-4 pb-4 px-4 flex justify-between items-center relative shrink-0">
          <div className="flex-1 flex justify-start z-10">
            <button onClick={onClose} className="text-accent text-[17px]">Cancel</button>
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 z-0 font-semibold text-[17px]">Settings</div>
          <div className="flex-1 flex justify-end z-10">
            <button onClick={d.save} className="text-accent text-[17px] font-semibold">Save</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-6">
          <BrokerSection draft={d.draft} set={d.set} />
          <LedgerSection draft={d.draft} set={d.set} />
          <TradeCommentSection draft={d.draft} set={d.set} />
          <AutoTradingSection draft={d.draft} set={d.set} />

          <FundsSection
            summary={d.summary}
            balanceDraft={d.balanceDraft}
            error={d.fundsError}
            onBalanceChange={(value) => {
              // Digits and a single point only: this feeds a balance, not free text.
              d.setBalanceDraft(value.replace(/[^0-9.]/g, ''));
              d.setFundsError(null);
            }}
            onBalanceBlur={() => {
              // Whatever can't be read as an amount reverts to the balance that's saved.
              const value = Number.parseFloat(d.balanceDraft);
              d.setBalanceDraft(
                (Number.isFinite(value) ? Math.max(0, value) : d.book.balance).toFixed(2)
              );
            }}
          />

          <AccountTypeSection
            draft={d.draft}
            selectedOption={d.selectedOption}
            suffixOptions={d.suffixOptions}
            open={d.typeOpen}
            onToggleOpen={() => d.setTypeOpen(!d.typeOpen)}
            customSuffix={d.customSuffix}
            onCustomSuffixChange={d.setCustomSuffix}
            onAddCustomSuffix={d.addCustomSuffix}
            onRemoveCustomSuffix={d.removeCustomSuffix}
            onSelectSuffix={(value) => {
              d.set('symbolSuffix', value);
              d.setTypeOpen(false);
            }}
          />

          {/*
            The Information section is gone with the last field in it. Mailbox and News are both
            generated now — one from the broker's name, one dealt from a fixed set by account
            number. Neither was ever a preference.
          */}

          <MarketDataSection
            publishedCandles={publishedCandles}
            publishedDays={publishedDays}
            publishedCount={publishedCount}
            perSymbolBytes={perSymbolBytes}
          />

          <LocalDataSection
            storage={d.storage}
            confirmDelete={d.confirmDelete}
            onReset={d.resetData}
          />

          <div className="h-[calc(2.5rem+var(--safe-bottom))] w-full pointer-events-none" />
        </div>
      </div>
    </Portal>
  );
}
