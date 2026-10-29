'use client';

import React, { useEffect, useState } from 'react';
import Portal from '@/components/ui/Portal';
import ViewLayout from '@/components/ui/ViewLayout';
import PlusIcon from '@/components/icons/Plus';
import { DemoPill } from '@/components/settings/parts/DemoMarks';
import { useAccount } from '@/lib/account';
import { groupedMoney } from '@/lib/money';
import { DEPOSIT_CURRENCY } from '@/lib/trading/math';
import { useBook } from '@/lib/trading/store';

/** iOS's push: in from the right edge, out the same way. */
const PUSH_MS = 350;
const PUSH_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** The broker's tile: its first word, lower-case, on the yellow square. */
function BrokerTile({ brokerName }: { brokerName: string }) {
  const word = brokerName.split(/\s+/)[0]?.toLowerCase() ?? '';
  return (
    <div className="w-[32px] h-[32px] shrink-0 bg-[#ffdf01] flex items-center justify-center overflow-hidden">
      <span className="text-[#1c1c1e] text-[7.5px] font-medium tracking-tight">{word}</span>
    </div>
  );
}

/**
 * The account list behind the Settings card, as the terminal's: a back button, "Accounts", and
 * one full-bleed row per account. Pushed over the whole app, tab bar included.
 */
export default function AccountsPage({ open, onClose }: { open: boolean; onClose: () => void }) {
  const account = useAccount();
  const book = useBook();

  // Mounted for the length of the exit as well, so it can slide away rather than vanish.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), PUSH_MS);
    return () => clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[70] bg-black pt-[var(--safe-top)]"
        style={{
          transform: shown ? 'translate3d(0, 0, 0)' : 'translate3d(100%, 0, 0)',
          transition: `transform ${PUSH_MS}ms ${PUSH_EASE}`,
        }}
      >
        <ViewLayout
          headerLeft={
            <button
              type="button"
              onClick={onClose}
              aria-label="Back"
              className="glass-control w-[44px] h-[44px] rounded-full flex items-center justify-center"
            >
              <svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 2L2 10L10 18" />
              </svg>
            </button>
          }
          headerCenter={<div className="font-semibold text-[17px]">Accounts</div>}
          headerRight={
            <button
              type="button"
              aria-label="Add account"
              aria-disabled="true"
              className="glass-control w-[44px] h-[44px] rounded-full flex items-center justify-center"
            >
              <PlusIcon />
            </button>
          }
        >
          <div className="pt-[18px]">
            <div className="relative flex items-center bg-surface h-[85px] pl-4 pr-4">
              <BrokerTile brokerName={account.brokerName} />
              <div className="flex-1 min-w-0 ml-[17px]">
                <div className="text-accent text-[19px] font-semibold leading-[24px] truncate pr-16">
                  {account.holderName}
                </div>
                <div className="text-white text-[15px] leading-[20px] truncate">
                  {account.accountNumber} - {account.serverName}
                </div>
                <div className="text-white text-[15px] leading-[20px] truncate">
                  {groupedMoney(book.balance)} {DEPOSIT_CURRENCY}, Hedge
                </div>
              </div>
              <div className="absolute top-[12px] right-4">
                <DemoPill />
              </div>
              <svg
                width="8"
                height="13"
                viewBox="0 0 8 13"
                fill="none"
                className="absolute right-[17px] top-[50px]"
              >
                <path d="M1.5 1.5L6.5 6.5L1.5 11.5" stroke="#a9a9ab" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
          </div>
        </ViewLayout>
      </div>
    </Portal>
  );
}
