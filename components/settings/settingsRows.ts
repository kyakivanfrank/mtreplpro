import type React from 'react';
import NewAccountIcon from '@/components/icons/NewAccount';
import MailboxIcon from '@/components/icons/Mailbox';
import NewsIcon from '@/components/icons/News';
import TradaysIcon from '@/components/icons/Tradays';
import PointinghandIcon from '@/components/icons/Pointinghand';
import Mql5Icon from '@/components/icons/Mql5';
import TelegramIcon from '@/components/icons/Telegram';
import KeyholeIcon from '@/components/icons/Keyhole';
import AppletranslateIcon from '@/components/icons/Appletranslate';
import ChartsSectionIcon from '@/components/icons/ChartsSection';
import JournalIcon from '@/components/icons/Journal';
import MT5Icon from '@/components/icons/MT5icon';

/**
 * Per-icon placement knobs for the fixed 32x32 box that centres each glyph.
 *
 * Symmetric `padding` looks identical to none — the glyph has a fixed size and stays centred —
 * so it is *asymmetric* padding that nudges (`pl-1` moves right 2px). Set `size` to
 * `w-full h-full` to make padding shrink the glyph instead. `boxClass` is the escape hatch.
 */
export type IconTuning = {
  /** Glyph size. Default `w-5 h-5`. Use `w-full h-full` to make `padding` resize it. */
  size?: string;
  /** Padding inside the box — the knob for nudging/insetting this icon. Default `p-0`. */
  padding?: string;
  /** Glyph colour. Default `text-white`. Set to `''` for icons that carry their own colours. */
  tint?: string;
  /** Extra classes on the box itself, for anything padding can't do. */
  boxClass?: string;
};

export const ICON_DEFAULTS: Required<Omit<IconTuning, 'boxClass'>> & { boxClass: string } = {
  size: 'w-5 h-5',
  padding: 'p-0',
  tint: 'text-white',
  boxClass: '',
};

export type SettingsRow = {
  key: string;
  title: string;
  subtitle?: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  /** Background of the rounded box. Omit to render the glyph bare, with no box. */
  bgClass?: string;
  /** Per-icon padding/size overrides — see IconTuning above. */
  icon?: IconTuning;
};

/* Tile colours sampled from the real terminal's Settings screen. */

export const accountRows = (mailbox: string, news: string): SettingsRow[] => [
  {
    key: 'new-account',
    title: 'New Account',
    Icon: NewAccountIcon,
    icon: { size: 'w-8 h-8' },
  },
  {
    key: 'mailbox',
    title: 'Mailbox',
    subtitle: mailbox,
    Icon: MailboxIcon,
    bgClass: 'bg-[#59c7fa]',
  },
  {
    key: 'news',
    title: 'News',
    subtitle: news,
    Icon: NewsIcon,
    bgClass: 'bg-[#fea527]',
  },
  {
    key: 'tradays',
    title: 'Tradays',
    subtitle: 'Economic calendar',
    Icon: TradaysIcon,
    bgClass: 'bg-[#d32f30]',
  },
];

export const COMMUNITY_ROWS: SettingsRow[] = [
  {
    key: 'chat',
    title: 'Chat and Messages',
    subtitle: 'Sign in to MQL5.community!',
    Icon: PointinghandIcon,
    bgClass: 'bg-[#4e7dc5]',
  },
  {
    key: 'traders-community',
    title: 'Traders Community',
    Icon: Mql5Icon,
    bgClass: 'bg-[#2c6bcc]',
  },
  {
    key: 'algo-trading',
    title: 'MQL5 Algo Trading',
    Icon: TelegramIcon,
    bgClass: 'bg-[#2baaed]',
  },
];

export const TOOLS_ROWS: SettingsRow[] = [
  {
    key: 'otp',
    title: 'OTP',
    subtitle: 'One-time password generator',
    Icon: KeyholeIcon,
    bgClass: 'bg-[#4bd963]',
  },
  {
    key: 'interface',
    title: 'Interface',
    subtitle: 'English',
    Icon: AppletranslateIcon,
    bgClass: 'bg-accent-ios',
    // Fills its tile rather than sitting in it. Both this and Settings below are drawn as
    // complete tiles — art already carried to the edge of its own viewBox — so the 20px glyph
    // the other rows use left them floating in a box they were supposed to *be*. `overflow-
    // hidden` is what makes the box's 8px radius cut the art instead of the art overhanging it.
    icon: { size: 'w-full h-full', boxClass: 'overflow-hidden' },
  },
  {
    key: 'charts',
    title: 'Charts',
    Icon: ChartsSectionIcon,
    bgClass: 'bg-[#1c9cff]',
  },
  {
    key: 'journal',
    title: 'Journal',
    Icon: JournalIcon,
    bgClass: 'bg-[#bec4d0]',
  },
  {
    key: 'settings',
    title: 'Settings',
    Icon: MT5Icon,
    // Still a fill behind it: the app icon's corners are transparent, so this is what shows
    // through where the 8px radius cuts them.
    bgClass: 'bg-surface',
    icon: { size: 'w-full h-full', tint: '', boxClass: 'overflow-hidden' },
  },
];
