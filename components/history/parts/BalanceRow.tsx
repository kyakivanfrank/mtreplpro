import React from 'react';
import type { BalanceOp } from '@/lib/trading/types';
import { groupedMoney } from '@/lib/money';
import { stampSecond } from '@/lib/timeFormat';
import { resultTone } from '@/components/ui/tone';

/**
 * A deposit or withdrawal, filed in the ledger the way MT5 files a balance deal.
 *
 * The second line is the deal's *comment* slot, and what a server writes there when it moves
 * money is the account it moved it on. No ticket and no `+`: the sign lives in the colour. The
 * name arrives already lettered — `D-` in, `W-` out.
 *
 * `note` takes the name's place when the broker booked it rather than the account holder — the
 * credit squaring a stop-out is arithmetically a deposit but was nobody's payment in.
 */
export default function BalanceRow({ op, account }: { op: BalanceOp; account: string }) {
  const isDeposit = op.amount >= 0;

  return (
    <div className="flex flex-col px-1.5 py-2.5">
      <div className="flex justify-between items-center mb-1">
        <span className="font-semibold text-[16px] leading-none symbol-condensed tracking-tight">Balance</span>
        <span className={`font-semibold text-[16px] leading-none tabular-nums ${resultTone(isDeposit)}`}>
          {groupedMoney(op.amount)}
        </span>
      </div>
      <div className="flex justify-between items-center font-inter text-muted text-[13px]">
        <span>{op.note || account || (isDeposit ? 'Deposit' : 'Withdrawal')}</span>
        <span>{stampSecond(op.time)}</span>
      </div>
    </div>
  );
}
