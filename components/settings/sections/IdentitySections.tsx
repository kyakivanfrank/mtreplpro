import React from 'react';
import Section from '@/components/settings/fields/Section';
import Field from '@/components/settings/fields/Field';
import { DEFAULT_ACCOUNT, MAX_TRADE_COMMENT, type AccountConfig } from '@/lib/account';

type Set = <K extends keyof AccountConfig>(key: K, value: AccountConfig[K]) => void;

/** The five fields that name the account on this screen. */
export function BrokerSection({ draft, set }: { draft: AccountConfig; set: Set }) {
  return (
    <Section title="Broker">
      <Field label="Name" value={draft.holderName} onChange={(v) => set('holderName', v)} />
      <Field label="Broker" value={draft.brokerName} onChange={(v) => set('brokerName', v)} />
      <Field label="Account" value={draft.accountNumber} onChange={(v) => set('accountNumber', v)} inputMode="numeric" />
      <Field label="Server" value={draft.serverName} onChange={(v) => set('serverName', v)} />
      <Field label="Location" value={draft.serverLocation} onChange={(v) => set('serverLocation', v)} last />
    </Section>
  );
}

/**
 * Its own section rather than a sixth row under Broker, because it is the only field here whose
 * effect is somewhere else — a footer explaining that would read as a note about all five.
 */
export function LedgerSection({ draft, set }: { draft: AccountConfig; set: Set }) {
  return (
    <Section
      title="Ledger"
      footer="The payment system named on every deposit and withdrawal on the History screen. A deposit reads D-ngbank-USD-96f61e93f49b45 and a withdrawal W-ngbank-USD-e22e78730d9d45; the code at the end is different on every row."
    >
      <Field
        label="Bank"
        value={draft.ledgerBank}
        onChange={(v) => set('ledgerBank', v.toLowerCase())}
        placeholder={DEFAULT_ACCOUNT.ledgerBank}
        last
      />
    </Section>
  );
}

/** Its own section for the same reason Ledger has one: it writes a line onto every open trade. */
export function TradeCommentSection({ draft, set }: { draft: AccountConfig; set: Set }) {
  return (
    <Section
      title="Trade"
      footer={`Carried by every open position and shown under its Stop Loss and Take Profit when you tap the trade. Leave it empty and no line is shown at all — the trade detail closes up as though the field were not there. Up to ${MAX_TRADE_COMMENT} characters, which is what a trade can carry.`}
    >
      <Field
        label="Comment"
        value={draft.tradeComment}
        onChange={(v) => set('tradeComment', v)}
        placeholder="none"
        maxLength={MAX_TRADE_COMMENT}
        last
      />
    </Section>
  );
}
