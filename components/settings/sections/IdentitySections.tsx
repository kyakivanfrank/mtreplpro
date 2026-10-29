import React from 'react';
import Section from '@/components/settings/fields/Section';
import Field from '@/components/settings/fields/Field';
import { accountBody, MAX_TRADE_COMMENT, type AccountConfig } from '@/lib/account';

/**
 * The identifier the Ledger footer explains itself with.
 *
 * A literal rather than the live value: the footer's job is to show what the *letters* do, and
 * threading the user's own name through a sentence that prints it three times buries the rule.
 */
const LEDGER_EXAMPLE = 'EXNESSMT5TRIAL9-USD-32914776';

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
 *
 * Placeholdered, never pre-filled: writing the composed value into the box would freeze it, and
 * the field would stop following the Account and Server above it.
 */
export function LedgerSection({ draft, set }: { draft: AccountConfig; set: Set }) {
  return (
    <Section
      title="Ledger"
      footer={`Names every deposit and withdrawal on the History screen, and heads the balance summary at the foot of it. Each row is lettered by direction — D for money paid in, W for money taken out — so ${LEDGER_EXAMPLE} appears there as D-${LEDGER_EXAMPLE} on a deposit and W-${LEDGER_EXAMPLE} on a withdrawal. Leave it empty and it is composed from the server, the deposit currency and the account number above.`}
    >
      <Field
        label="Name"
        value={draft.accountLabel}
        onChange={(v) => set('accountLabel', v)}
        placeholder={accountBody({ ...draft, accountLabel: '' })}
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
