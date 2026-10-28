'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { spanLabel, stampMinute as stamp } from '@/lib/timeFormat';
import { NORMAL_SPEED, SPEED_STEPS } from '@/lib/market/session';

/* ------------------------------------------------------------------ */
/*  Playback panel                                                     */
/* ------------------------------------------------------------------ */
/**
 * Play, a scrubber, and where to start looking from. Nothing else.
 *
 * The track's right end is fixed at the newest bar the device holds and is not a control: there
 * is nothing to gain from stopping the session short of its own data, and an end you could pin
 * was a second way of saying "pause" plus a way to strand a run behind the tape.
 *
 * The left end is the only thing being chosen — how far back to begin — and it is set by typing
 * or picking a date and a time, because "the London open on the 14th" is a thing you know and
 * a pixel on a two-week bar is not. Dragging it would be guessing; the fields are exact.
 *
 * The knob is the clock. It opens at the start, goes anywhere along the track, and play simply
 * carries it on from wherever it was left.
 */

interface WindowPanelProps {
  /** Oldest and newest bar in the archive, unix ms. The track's two ends. */
  fromMs: number;
  toMs: number;
  startMs: number;
  clockMs: number;
  playing: boolean;
  onSetStart: (ms: number) => void;
  onSeek: (ms: number) => void;
  /**
   * Where the knob is right now, mid-drag.
   *
   * Separate from `onSeek` on purpose: seeking backwards clears the book, so it happens once,
   * on release. This one only moves the veil on the chart, which is what makes the drag read as
   * revealing tape rather than as a slider that jumps when you let go.
   */
  onPreview: (draft: { start: number; end: number; now: number }) => void;
  onTogglePlay: () => void;
  onClose: () => void;
  /** Multiple of normal speed, one of `SPEED_STEPS`. */
  speed: number;
  onSetSpeed: (speed: number) => void;
}

const MINUTE = 60_000;

/*
 * The fields speak UTC, like every other timestamp in the app.
 *
 * `toISOString` would do this in one line, but it also drags the browser's timezone into a
 * value the user is about to compare against a candle — 05:00 typed in Kampala must mean 05:00
 * on the chart, not 02:00.
 */
function dateValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function timeValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function fromFields(date: string, time: string): number | null {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return Date.UTC(y, m - 1, d, hh, mm, 0, 0);
}

export default function WindowPanel({
  fromMs,
  toMs,
  startMs,
  clockMs,
  playing,
  onSetStart,
  onSeek,
  onPreview,
  onTogglePlay,
  onClose,
  speed,
  onSetSpeed,
}: WindowPanelProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  /** The knob's position while a finger is on it. Null means "follow the session". */
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubRef = useRef<number | null>(null);

  const [date, setDate] = useState(() => dateValue(startMs));
  const [time, setTime] = useState(() => timeValue(startMs));

  // The session is the source of truth: a start changed anywhere else, or clamped on commit,
  // has to show up in the fields rather than leaving them lying about what is set.
  useEffect(() => {
    setDate(dateValue(startMs));
    setTime(timeValue(startMs));
  }, [startMs]);

  const knobMs = scrub ?? clockMs;
  const span = Math.max(1, toMs - startMs);
  const fraction = Math.min(1, Math.max(0, (knobMs - startMs) / span));

  const msAt = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track) return knobMs;

      const rect = track.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
      return Math.round(startMs + f * span);
    },
    [knobMs, startMs, span]
  );

  const put = useCallback(
    (ms: number) => {
      scrubRef.current = ms;
      setScrub(ms);
      onPreview({ start: startMs, end: toMs, now: ms });
    },
    [onPreview, startMs, toMs]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      put(msAt(e.clientX));
    };

    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;

      // Committed once, here. Backwards is a rewind and clears the book, which is not something
      // to do sixty times while a finger slides.
      const target = scrubRef.current;
      scrubRef.current = null;
      setScrub(null);
      if (target !== null) onSeek(target);
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [msAt, onSeek, put]);

  /** Commit whatever the two fields currently say, clamped to what the archive holds. */
  const commitStart = (nextDate: string, nextTime: string) => {
    const parsed = fromFields(nextDate, nextTime);
    if (parsed === null) return;

    const clamped = Math.min(toMs - MINUTE, Math.max(fromMs, parsed));
    onSetStart(clamped);
  };

  return (
    <div className="absolute left-2 right-2 bottom-2 z-50 rounded-[12px] bg-surface/95 border border-white/10 backdrop-blur px-3 py-2.5">
      {/* Play, the clock it is at, and the way out */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          className="w-7 h-7 shrink-0 rounded-full bg-accent flex items-center justify-center text-white"
        >
          {playing ? (
            <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
              <rect x="1.5" y="1" width="3" height="10" rx="1" />
              <rect x="7.5" y="1" width="3" height="10" rx="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor">
              <path d="M2.5 1.2v9.6a.6.6 0 0 0 .92.5l7.2-4.8a.6.6 0 0 0 0-1L3.42.7a.6.6 0 0 0-.92.5Z" />
            </svg>
          )}
        </button>

        <span className="text-white text-[12px] font-semibold tabular-nums">{stamp(knobMs)}</span>
        <span className="text-faint text-[10px] tabular-nums ml-auto">
          {spanLabel(toMs - knobMs)} left
        </span>
        <button onClick={onClose} className="text-muted text-[13px] leading-none w-4 shrink-0">
          ✕
        </button>
      </div>

      {/* The track. Left end is the chosen start, right end is wherever the data stops. */}
      <div
        ref={trackRef}
        onPointerDown={(e) => {
          e.preventDefault();
          dragging.current = true;
          put(msAt(e.clientX));
        }}
        className="relative h-9 flex items-center cursor-pointer"
        style={{ touchAction: 'none' }}
      >
        <div className="absolute left-0 right-0 h-1.5 rounded-full bg-surface-3" />
        {/* What has been played, so the knob has something to have travelled along. */}
        <div
          className="absolute left-0 h-1.5 rounded-full bg-accent/50"
          style={{ width: `${fraction * 100}%` }}
        />
        <div
          role="slider"
          aria-label="Seek"
          aria-valuemin={startMs}
          aria-valuemax={toMs}
          aria-valuenow={knobMs}
          className="absolute w-3 h-3 -ml-1.5 rounded-full bg-white shadow ring-2 ring-accent"
          style={{ left: `${fraction * 100}%` }}
        />
      </div>

      {/* Where to start looking from */}
      <div className="flex items-center gap-2">
        <span className="text-muted text-[10px] uppercase tracking-wide shrink-0">Start</span>

        <input
          type="date"
          value={date}
          min={dateValue(fromMs)}
          max={dateValue(toMs)}
          onChange={(e) => {
            setDate(e.target.value);
            commitStart(e.target.value, time);
          }}
          className="bg-surface-2 text-white text-[11px] tabular-nums rounded-[6px] px-1.5 py-1 outline-none [color-scheme:dark]"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => {
            setTime(e.target.value);
            commitStart(date, e.target.value);
          }}
          className="bg-surface-2 text-white text-[11px] tabular-nums rounded-[6px] px-1.5 py-1 outline-none [color-scheme:dark]"
        />

        <span className="text-faint text-[10px] tabular-nums ml-auto whitespace-nowrap">
          {spanLabel(toMs - startMs)} of data
        </span>
      </div>

      <SpeedSlider speed={speed} onSetSpeed={onSetSpeed} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Speed                                                              */
/* ------------------------------------------------------------------ */
/**
 * Fifteen notches, normal in the middle, and nothing in between them.
 *
 * Snapping rather than a free slider because the steps are not evenly spaced in value: the
 * gap between 0.05 and 0.1 is the same physical distance as the gap between 100 and 200,
 * which is what lets one short track reach from a crawl to a sprint. A position between two
 * notches would be a speed nobody asked for.
 *
 * Applied live while dragging. Unlike a seek it changes nothing but the rate, so there is no
 * book to protect and no reason to wait for the finger to lift.
 */
function SpeedSlider({ speed, onSetSpeed }: { speed: number; onSetSpeed: (speed: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const last = SPEED_STEPS.length - 1;
  const normalIndex = SPEED_STEPS.indexOf(NORMAL_SPEED as (typeof SPEED_STEPS)[number]);

  // Nearest notch to whatever is stored, so a value from an older build still lands somewhere.
  const index = SPEED_STEPS.reduce(
    (best, step, i) => (Math.abs(step - speed) < Math.abs(SPEED_STEPS[best] - speed) ? i : best),
    0
  );

  const indexAt = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track) return index;
      const rect = track.getBoundingClientRect();
      const f = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
      return Math.round(f * last);
    },
    [index, last]
  );

  const pick = useCallback(
    (i: number) => {
      const step = SPEED_STEPS[i];
      if (step !== speed) onSetSpeed(step);
    },
    [onSetSpeed, speed]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      pick(indexAt(e.clientX));
    };
    const onUp = () => {
      dragging.current = false;
    };

    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [indexAt, pick]);

  const pct = (i: number) => (i / last) * 100;
  const fill = pct(index);
  const mid = pct(normalIndex);

  return (
    <div className="mt-2.5 flex items-center gap-2">
      <div className="flex items-center gap-1 shrink-0">
        <span className="text-muted text-[10px] uppercase tracking-wide">Speed</span>
        <span className="text-white text-[11px] font-semibold tabular-nums">{SPEED_STEPS[index]}×</span>
      </div>

      {/* Inset by half a knob so the end notches and their numbers are not clipped. */}
      <div className="relative flex-1 px-1.5">
        <div
          ref={trackRef}
          id="replay-speed-slider"
          role="slider"
          aria-label="Playback speed"
          aria-valuemin={SPEED_STEPS[0]}
          aria-valuemax={SPEED_STEPS[last]}
          aria-valuenow={SPEED_STEPS[index]}
          aria-valuetext={`${SPEED_STEPS[index]} times normal`}
          tabIndex={0}
          onPointerDown={(e) => {
            e.preventDefault();
            dragging.current = true;
            pick(indexAt(e.clientX));
          }}
          onDoubleClick={() => pick(normalIndex)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') pick(Math.max(0, index - 1));
            else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') pick(Math.min(last, index + 1));
            else if (e.key === 'Home') pick(0);
            else if (e.key === 'End') pick(last);
            else return;
            e.preventDefault();
          }}
          className="relative h-6 flex items-center cursor-pointer outline-none"
          style={{ touchAction: 'none' }}
        >
          <div className="absolute left-0 right-0 h-1 rounded-full bg-surface-3" />

          {/* Grows outward from normal: left of centre is slow-motion, right is fast-forward. */}
          <div
            className="absolute h-1 rounded-full bg-accent/50 transition-[left,width] duration-150"
            style={{ left: `${Math.min(fill, mid)}%`, width: `${Math.abs(fill - mid)}%` }}
          />

          {SPEED_STEPS.map((step, i) => (
            <div
              key={step}
              className={`absolute -translate-x-1/2 rounded-full ${
                i === normalIndex
                  ? 'w-[2px] h-3.5 bg-white/80'
                  : i === 0 || i === last
                  ? 'w-[1.5px] h-2.5 bg-white/50'
                  : 'w-px h-1.5 bg-white/20'
              }`}
              style={{ left: `${pct(i)}%` }}
            />
          ))}

          <div
            className="absolute w-3 h-3 -ml-1.5 rounded-full bg-white shadow ring-2 ring-accent transition-[left] duration-150"
            style={{ left: `${fill}%` }}
          />
        </div>

        {/* The extremes on both ends and the mid completely in the middle */}
        <div className="relative h-2.5">
          <span
            className={`absolute left-0 text-[7.5px] leading-none tabular-nums ${
              index === 0 ? 'text-white font-semibold' : 'text-faint'
            }`}
          >
            {SPEED_STEPS[0]}×
          </span>
          <span
            className={`absolute left-1/2 -translate-x-1/2 text-[7.5px] leading-none tabular-nums ${
              index === normalIndex ? 'text-white font-semibold' : 'text-muted font-medium'
            }`}
          >
            {NORMAL_SPEED}×
          </span>
          <span
            className={`absolute right-0 text-[7.5px] leading-none tabular-nums ${
              index === last ? 'text-white font-semibold' : 'text-faint'
            }`}
          >
            {SPEED_STEPS[last]}×
          </span>
        </div>
      </div>
    </div>
  );
}
