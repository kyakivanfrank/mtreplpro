import React from 'react';
import Section from '@/components/settings/fields/Section';
import ReadoutRow from '@/components/settings/fields/ReadoutRow';
import { ACCOUNT_LEVERAGE, accountSummary, isUnlimitedLeverage } from '@/lib/trading/math';

/**
 * The balance, and what it is currently worth.
 *
 * Only the top row is editable. The four below are a readout of the account as it stands, and
 * the withdrawal limit is re-checked against live prices on Save regardless of what they say.
 */
export default function FundsSection({
  summary,
  balanceDraft,
  onBalanceChange,
  onBalanceBlur,
  error,
}: {
  summary: ReturnType<typeof accountSummary>;
  balanceDraft: string;
  onBalanceChange: (value: string) => void;
  onBalanceBlur: () => void;
  error: string | null;
}) {
  return (
    <Section title="Account">
      <div className="flex items-center py-2 min-h-[48px] border-b border-hairline">
        <span className="text-white text-[17px] w-[92px] shrink-0">Balance</span>
        <span className="text-muted text-[17px] pr-1">USD</span>
        <input
          value={balanceDraft}
          inputMode="decimal"
          onChange={(e) => onBalanceChange(e.target.value)}
          onBlur={onBalanceBlur}
          className="flex-1 bg-transparent text-white outline-none text-[17px] text-right tabular-nums"
        />
      </div>

      <ReadoutRow size="sm" label="Equity" value={summary.equity.toFixed(2)} />

      {/*
        Leverage, then margin — and margin only when there is any. The leverage row is the
        account term; the margin row is what that term is currently costing, so it stays out of
        the way of a flat account.
      */}
      <ReadoutRow
        size="sm"
        label="Leverage"
        value={isUnlimitedLeverage() ? 'Unlimited' : `1:${ACCOUNT_LEVERAGE}`}
      />
      {summary.margin > 0 && (
        <ReadoutRow size="sm" label="Margin in use" value={summary.margin.toFixed(2)} />
      )}
      <ReadoutRow size="sm" label="Free margin" value={summary.freeMargin.toFixed(2)} divider="none" />

      {error && (
        <div className="pb-2.5 -mt-1 text-danger text-[13px] leading-[18px]">{error}</div>
      )}
    </Section>
  );
}
