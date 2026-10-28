import React from 'react';
import SummaryRow from '@/components/ui/SummaryRow';
import { money } from '@/lib/money';
import type { accountSummary } from '@/lib/trading/math';

/**
 * The margin block, in MT5's order: balance, equity, margin, free margin, margin level.
 *
 * Both margin rows appear only while something is open — a flat account has no collateral tied
 * up and so no ratio to state. `margin > 0` and `holding` are the same test at 1:500 but are
 * written separately, because they part company if `ACCOUNT_LEVERAGE` goes back to `Infinity`.
 * That is also what the `∞` is for: unbounded is the safest an account can be, where `0.00`
 * would claim the worst.
 */
export default function AccountSummary({
  summary,
  holding,
}: {
  summary: ReturnType<typeof accountSummary>;
  holding: boolean;
}) {
  return (
    <div className="px-1.5">
      <SummaryRow variant="trade" label="Balance:" value={money(summary.balance)} />
      <SummaryRow variant="trade" label="Equity:" value={money(summary.equity)} />
      {summary.margin > 0 && (
        <SummaryRow variant="trade" label="Margin:" value={money(summary.margin)} />
      )}
      <SummaryRow variant="trade" label="Free Margin:" value={money(summary.freeMargin)} />
      {holding && (
        <SummaryRow
          variant="trade"
          label="Margin Level (%):"
          value={summary.marginLevel === null ? '∞' : money(summary.marginLevel)}
        />
      )}
    </div>
  );
}
