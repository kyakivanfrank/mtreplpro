import React from 'react';
import type { AccountConfig } from '@/lib/account';
import { DemoRibbon } from '@/components/settings/parts/DemoMarks';

/**
 * The account identity block at the top of the first card, with the Demo ribbon in its corner.
 * Tapping it opens the account list, as on the terminal.
 */
export default function AccountCard({
  account,
  onOpen,
}: {
  account: AccountConfig;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative w-full flex items-center pt-3 pb-[9px] border-b border-hairline active:bg-white/5"
    >
      <DemoRibbon />
      <div className="flex-1 flex flex-col items-center text-center text-white">
        <span className="text-[18px] leading-[22px]">{account.holderName}</span>
        <span className="text-[15px] leading-[20px] mt-[1px]">{account.brokerName}</span>
        <span className="text-[15px] leading-[20px] mt-[6px]">
          {account.accountNumber} - {account.serverName}
        </span>
        <span className="text-[15px] leading-[20px]">{account.serverLocation}</span>
      </div>
      <svg width="8" height="13" viewBox="0 0 8 13" fill="none" className="absolute right-0 top-1/2 -mt-[6px]">
        <path d="M1.5 1.5L6.5 6.5L1.5 11.5" stroke="#5a595e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
