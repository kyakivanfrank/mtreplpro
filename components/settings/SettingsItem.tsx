import React, { ReactNode } from 'react';

interface SettingsItemProps {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  rightElement?: ReactNode;
  showChevron?: boolean;
  hasDivider?: boolean;
  onClick?: () => void;
  iconContainerClassName?: string;
}

export default function SettingsItem({
  icon,
  title,
  subtitle,
  rightElement,
  showChevron = true,
  hasDivider = true,
  onClick,
  iconContainerClassName = "mr-4",
}: SettingsItemProps) {
  return (
    <div
      className="flex flex-row items-center  active:bg-white/5 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className={`flex-shrink-0 ${iconContainerClassName}`}>
        {icon}
      </div>

      {/* `min-w-0` has to be on *both* flex levels. A flex item's default `min-width: auto`
          floors it at its content's min-content width, and a `truncate`d subtitle is
          `whitespace-nowrap`, so its min-content is the whole string — without this the row
          would just widen and push the chevron off the edge instead of ellipsising. The
          right-hand group is `flex-shrink-0` so the chevron keeps its box no matter what. */}
      <div className={`flex-1 min-w-0 flex flex-row justify-between items-center py-[8px] min-h-[48px] ${hasDivider ? 'border-b border-hairline' : ''}`}>
        {/* Title-to-subtitle baselines 19pt apart and two-line rows 54pt tall, as on the real terminal. */}
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <span className="text-white text-[17px] leading-[21px] truncate">{title}</span>
          {subtitle && (
            <span className="text-muted text-[15px] leading-[17px] truncate">{subtitle}</span>
          )}
        </div>

        <div className="flex-shrink-0 flex items-center ml-2">
          {rightElement}
          {showChevron && (
            <svg width="8" height="13" viewBox="0 0 8 13" fill="none" xmlns="http://www.w3.org/2000/svg" className="ml-2">
              <path d="M1.5 1.5L6.5 6.5L1.5 11.5" stroke="#5a595e" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
