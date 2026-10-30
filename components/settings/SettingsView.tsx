'use client';

import React, { useState } from 'react';
import ViewLayout from '@/components/ui/ViewLayout';
import AccountSettingsModal from '@/components/settings/AccountSettingsModal';
import AccountsPage from '@/components/settings/AccountsPage';
import AccountCard from '@/components/settings/parts/AccountCard';
import SettingsRows from '@/components/settings/parts/SettingsRows';
import { accountRows, COMMUNITY_ROWS, TOOLS_ROWS } from '@/components/settings/settingsRows';
import { mailboxSubtitle, newsSubtitle, useAccount } from '@/lib/account';

/** The rounded card each group of rows sits in. */
function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`relative bg-surface rounded-[26px] px-4 overflow-hidden ${className}`}>{children}</div>
  );
}

/**
 * The settings menu.
 *
 * Arrangement only. The rows themselves are data in `./settingsRows`, their glyph is in
 * `./parts`, and the account editor this opens is `./AccountSettingsModal`.
 */
export default function SettingsView() {
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const account = useAccount();

  /** Settings is the only row wired to anything; the rest are inert, as they always were. */
  const handlerFor = (key: string) =>
    key === 'settings' ? () => setAccountOpen(true) : undefined;

  return (
    <ViewLayout headerCenter={<div className="font-semibold text-[17px]">Settings</div>} edge="fade">
      <div className="px-4 space-y-[20px]">
        <Card>
          <AccountCard account={account} onOpen={() => setAccountsOpen(true)} />
          <SettingsRows
            rows={accountRows(mailboxSubtitle(account), newsSubtitle(account))}
            onSelect={handlerFor}
          />
        </Card>

        <Card>
          <SettingsRows rows={COMMUNITY_ROWS} onSelect={handlerFor} />
        </Card>

        <Card>
          <SettingsRows rows={TOOLS_ROWS} onSelect={handlerFor} />
        </Card>
      </div>

      <AccountsPage open={accountsOpen} onClose={() => setAccountsOpen(false)} />

      <AccountSettingsModal
        open={accountOpen}
        config={account}
        onClose={() => setAccountOpen(false)}
      />
    </ViewLayout>
  );
}
