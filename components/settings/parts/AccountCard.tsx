import React from 'react';
import type { AccountConfig } from '@/lib/account';

/**
 * The account identity block at the top of the first card.
 *
 * Display only — the Settings row below is the one door into the editor, so a stray tap up here
 * cannot open it.
 */
export default function AccountCard({ account }: { account: AccountConfig }) {
  return (
    <div className="flex flex-row items-center pb-2 border-b border-hairline">
      <div className="flex-1 flex flex-col items-center justify-center text-center">
        <span className="text-white font-semibold text-[16px] leading-snug">{account.holderName}</span>
        <span className="text-white text-[15px] leading-snug mt-0.5">{account.brokerName}</span>
        <span className="text-white text-[15px] leading-snug mt-1">
          {account.accountNumber} - {account.serverName}
        </span>
        <span className="text-white text-[15px] leading-snug mt-0.5">{account.serverLocation}</span>
      </div>
    </div>
  );
}
