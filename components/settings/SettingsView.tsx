'use client';

import React, { useState } from 'react';
import ViewLayout from '@/components/ui/ViewLayout';
import AccountSettingsModal from '@/components/settings/AccountSettingsModal';
import AccountCard from '@/components/settings/parts/AccountCard';
import SettingsRows from '@/components/settings/parts/SettingsRows';
import { useChatBadge } from '@/components/settings/useChatBadge';
import { accountRows, COMMUNITY_ROWS, TOOLS_ROWS } from '@/components/settings/settingsRows';
import { mailboxSubtitle, newsSubtitle, useAccount } from '@/lib/account';

/** The rounded card each group of rows sits in. */
function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`bg-surface rounded-[32px] px-5 overflow-hidden ${className}`}>{children}</div>
  );
}

/**
 * The settings menu.
 *
 * Arrangement only. The rows themselves are data in `./settingsRows`, their glyph and hamburger
 * are in `./parts`, and the account editor this opens is `./AccountSettingsModal`.
 */
export default function SettingsView() {
  const [accountOpen, setAccountOpen] = useState(false);
  const account = useAccount();
  const chatCount = useChatBadge();

  /** Settings is the only row wired to anything; the rest are inert, as they always were. */
  const handlerFor = (key: string) =>
    key === 'settings' ? () => setAccountOpen(true) : undefined;

  return (
    <ViewLayout
      // The only header that is text alone, so the only one that needs padding to have a height.
      headerClassName="fixed top-0 left-0 right-0 pt-3 pb-6 bg-black/60 backdrop-blur-md [mask-image:linear-gradient(to_bottom,black_60%,transparent_100%)]"
      headerCenter={<div className="font-semibold text-xl">Settings</div>}
    >
      <div className="px-4 pt-4 space-y-6">
        <Card className="pt-3">
          <AccountCard account={account} />
          <SettingsRows
            rows={accountRows(mailboxSubtitle(account), newsSubtitle(account))}
            badgeCount={chatCount}
            onSelect={handlerFor}
          />
        </Card>

        <Card className="pb-1">
          <SettingsRows rows={COMMUNITY_ROWS} badgeCount={chatCount} onSelect={handlerFor} />
        </Card>

        <Card>
          <SettingsRows
            rows={TOOLS_ROWS}
            badgeCount={chatCount}
            keepLastDivider
            onSelect={handlerFor}
          />
        </Card>
      </div>

      <AccountSettingsModal
        open={accountOpen}
        config={account}
        onClose={() => setAccountOpen(false)}
      />
    </ViewLayout>
  );
}
