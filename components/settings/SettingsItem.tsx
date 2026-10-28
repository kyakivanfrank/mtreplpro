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
      <div className={`flex-1 min-w-0 flex flex-row justify-between items-center  py-2 min-h-[48px] ${hasDivider ? 'border-b border-hairline' : ''}`}>
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <span className="text-white text-[17px] leading-tight truncate">{title}</span>
          {subtitle && (
            <span className="text-muted text-[16px] leading-tight mt-0.5 truncate">{subtitle}</span>
          )}
        </div>

        <div className="flex-shrink-0 flex items-center ml-2">
          {rightElement}
          {showChevron && (
            <svg width="9" height="14" viewBox="0 0 9 14" fill="none" xmlns="http://www.w3.org/2000/svg" className="ml-2">
              <path d="M2.00006 1.49994L7.50006 6.99994L2.00006 12.4999" stroke="#5c5c5e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
