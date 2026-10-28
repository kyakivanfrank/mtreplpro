'use client';

import React from 'react';
import CenterDialog from '@/components/ui/CenterDialog';

/* ------------------------------------------------------------------ */
/*  Balance — deposit / withdrawal shortcut                            */
/* ------------------------------------------------------------------ */
/**
 * The card icon in the Trade header opens this.
 *
 * Nothing but copy: the box, the pills and the dismissal all come from `CenterDialog`, which
 * is the reusable piece. This file exists to hold what makes this dialog *this* dialog.
 *
 * Deposit and Withdrawal are inert on purpose. MT5 hands both to the broker's website, and
 * this build has no such address — `AccountConfig` names a broker but carries no URL. They
 * still take the press animation, so they read as pressed rather than as dead, and they do not
 * dismiss: a button that closes the dialog without doing anything is indistinguishable from
 * Cancel, which would quietly teach that it worked.
 */

interface BalanceModalProps {
  open: boolean;
  onClose: () => void;
}

export default function BalanceModal({ open, onClose }: BalanceModalProps) {
  return (
    <CenterDialog
      open={open}
      onClose={onClose}
      title="Balance"
      description="Quickly navigate to account deposit/withdrawal pages on your broker's website"
      // Supporting copy, not the question. The two pills below already say Deposit and
      // Withdrawal; this line only explains where they go.
      descriptionSize="subhead"
      actions={[{ label: 'Deposit' }, { label: 'Withdrawal' }]}
    />
  );
}
