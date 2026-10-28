'use client';

import React from 'react';
import { createPortal } from 'react-dom';

/* ------------------------------------------------------------------ */
/*  Escape hatch out of the view                                       */
/* ------------------------------------------------------------------ */
/**
 * Renders its children into `<body>` instead of where they are written.
 *
 * ── The bug this exists to stop ──────────────────────────────────────
 *
 * `z-index` is only comparable inside one stacking context. Every screen here is a `ViewLayout`
 * whose scroll pane is `relative z-10`, and a positioned element with a `z-index` *is* a
 * stacking context — so everything inside that pane is flattened into a single layer at 10
 * before it is compared to anything outside it. A modal written as `z-[70]` and mounted from a
 * screen's own JSX is therefore not at 70 against the app. It is at 10, underneath the header
 * at 30 and the tab bar at 50, and its number looks correct in the source while being compared
 * against the wrong things.
 *
 * That is not a hypothetical: it is why the account sheet's Cancel and Save were unreachable
 * under the Settings header, and why the position sheet came up behind the tab bar. Both had
 * numbers well above what they were losing to.
 *
 * ── Why a portal rather than bigger numbers ──────────────────────────
 *
 * No number can fix it. Raising `z-[70]` to `z-[7000]` changes nothing, because the comparison
 * that matters happens one level up, between the pane's 10 and the header's 30. Deleting the
 * pane's `z-10` would fix it and break the watermark it exists to sit above. A portal moves the
 * element to where its `z-index` is measured against the things it is supposed to beat, which
 * is the actual problem rather than a symptom of it.
 *
 * ── The layer scale, in one place ────────────────────────────────────
 *
 * Everything portalled shares the root context, so these are now genuinely comparable:
 *
 *   50   tab bar
 *   60   symbol picker
 *   70   account settings
 *   75   order ticket
 *   80   dialogs and sheets
 *   90   login wall
 *   100  outage
 *
 * ── Server rendering ─────────────────────────────────────────────────
 *
 * There is no `document` on the server, so this renders nothing there. Safe for every caller,
 * because all of them are closed on first paint — a modal is opened by a tap, and a tap cannot
 * have happened before hydration. Nothing that is server-rendered visible should use this.
 */
export default function Portal({ children }: { children: React.ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}
