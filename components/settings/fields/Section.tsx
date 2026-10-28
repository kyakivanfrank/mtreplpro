import React from 'react';

/** A titled card with an optional explanatory footer — the grouping every settings block uses. */
export default function Section({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-muted text-[13px] uppercase tracking-wide px-1 pb-2 pt-1">{title}</div>
      <div className="bg-surface rounded-[12px] px-4">{children}</div>
      {footer && <div className="text-muted text-[12px] leading-[16px] px-1 pt-2">{footer}</div>}
    </div>
  );
}
