'use client';

import React from 'react';

/* ------------------------------------------------------------------ */
/*  iOS switch                                                         */
/* ------------------------------------------------------------------ */
/**
 * The pill toggle iOS uses for a setting that is simply on or off.
 *
 * A switch rather than a checkbox or a two-item picker, because those ask you to *choose* and
 * this one asks whether something is running. The distinction is visible in the animation: the
 * knob travels, so the control shows the state changing rather than just showing the new state.
 *
 * `role="switch"` and `aria-checked` rather than a styled `<input type="checkbox">`. The native
 * element brings a rendering nothing here wants and would have to be hidden to be styled, and a
 * hidden input is a thing that drifts out of sync with the visible one it is standing behind.
 */
interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** What this switches, for a screen reader. */
  label: string;
  disabled?: boolean;
}

export default function Switch({ checked, onChange, label, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`
        relative h-[31px] w-[51px] shrink-0 rounded-full
        transition-colors duration-200 ease-out
        ${checked ? 'bg-success' : 'bg-[#39393d]'}
        ${disabled ? 'opacity-40' : ''}
      `}
    >
      {/*
        The knob is moved with a transform rather than by animating `left`, so the travel is
        composited. A 51px slide re-laying-out every frame is exactly the kind of thing that
        stutters on the one device this is meant to feel native on.
      */}
      <span
        className={`
          absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white
          shadow-[0_2px_4px_rgba(0,0,0,0.25)]
          transition-transform duration-200 ease-out
          ${checked ? 'translate-x-[20px]' : 'translate-x-0'}
        `}
      />
    </button>
  );
}
