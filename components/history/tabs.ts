/** The three history tabs, shared by the screen and its header. */
export type Tab = 'Positions' | 'Orders' | 'Deals';

export const TABS: readonly Tab[] = ['Positions', 'Orders', 'Deals'] as const;
