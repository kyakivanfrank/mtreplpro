'use client';

import React from 'react';
import CenterDialog from '@/components/ui/CenterDialog';

/* ------------------------------------------------------------------ */
/*  Bulk operations                                                    */
/* ------------------------------------------------------------------ */
/**
 * The ••• beside the Positions header opens this.
 *
 * It replaced a one-item dropdown. A popover anchored to a small glyph is the wrong shape for
 * this: closing the book is not a menu choice, it is a decision, and the three ways to do it
 * differ by *which* trades disappear — a distinction worth reading at full size rather than
 * squinting at in a corner. The centred dialog stops the screen and lays the three side by
 * side, which is also how MT5 asks the same question.
 *
 * All four pills look identical whatever the book holds. An option with nothing to close simply
 * closes nothing — pressing "Close losing positions" with no losers is a no-op, not an error,
 * and greying it would make the dialog's own controls look half-broken every time the account
 * happened to be all green.
 */

interface CloseTradesModalProps {
  open: boolean;
  onClose: () => void;
  onCloseAll: () => void;
  onCloseProfitable: () => void;
  onCloseLosing: () => void;
}

export default function CloseTradesModal({
  open,
  onClose,
  onCloseAll,
  onCloseProfitable,
  onCloseLosing,
}: CloseTradesModalProps) {
  return (
    <CenterDialog
      open={open}
      onClose={onClose}
      title="Bulk Operations"
      align="center"
      actions={[
        { label: 'Close All Positions', onClick: onCloseAll, closes: true },
        { label: 'Close Profitable Positions', onClick: onCloseProfitable, closes: true },
        { label: 'Close Losing Positions', onClick: onCloseLosing, closes: true },
      ]}
    />
  );
}
