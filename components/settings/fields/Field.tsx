import React from 'react';

/** A labelled text input on one row. */
export default function Field({
  label,
  value,
  onChange,
  inputMode,
  placeholder,
  maxLength,
  last,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: 'numeric' | 'text';
  /** Shown when the field is empty — for a value that composes itself unless overridden. */
  placeholder?: string;
  /** Hard stop on what can be typed, for a value the platform itself limits. */
  maxLength?: number;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center py-2 min-h-[48px] ${last ? '' : 'border-b border-hairline'}`}>
      <span className="text-white text-[17px] w-[92px] shrink-0">{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-transparent text-muted outline-none text-[17px] text-right placeholder:text-[#5c6577]"
      />
    </div>
  );
}
