import React from 'react';
import Section from '@/components/settings/fields/Section';
import StepperRow from '@/components/settings/fields/StepperRow';
import Switch from '@/components/ui/Switch';
import {
  AUTO_MAX_GAP_SEC,
  AUTO_MAX_HOLD_SEC,
  AUTO_MAX_POSITIONS_PER_MOVE,
  AUTO_MIN_HOLD_SEC,
  type AccountConfig,
} from '@/lib/account';

/**
 * The switch, then everything it governs.
 *
 * Every row below is `disabled` while it is off: a hold range configured on a terminal that is
 * not trading describes nothing, and dimmed rows read as *settings for that mode* rather than as
 * knobs that quietly do nothing. They keep their values while disabled — turning the mode off
 * for an hour should not cost the user the configuration they built.
 */
export default function AutoTradingSection({
  draft,
  set,
}: {
  draft: AccountConfig;
  set: <K extends keyof AccountConfig>(key: K, value: AccountConfig[K]) => void;
}) {
  const off = !draft.autoTrade;

  return (
    <Section
      title="Automated Trading"
      footer="Trades whatever the chart is showing, by pressing the same buttons you would — same fills, same spread, same stops, same history. It reads the small timeframe for direction, holds for a random time inside the range below, and closes when the move has paid. Turning it off never touches a trade that is already open; that position stays yours to close."
    >
      <div className="flex items-center py-2 min-h-[48px] border-b border-hairline">
        <div className="flex-1">
          <div className="text-white text-[17px]">Automatic</div>
          <div className="text-muted text-[13px] leading-[18px]">
            {draft.autoTrade ? 'The terminal is trading' : 'Manual — you place every trade'}
          </div>
        </div>
        <Switch
          checked={draft.autoTrade}
          onChange={(on) => set('autoTrade', on)}
          label="Automated trading"
        />
      </div>

      <StepperRow
        label="Shortest hold"
        value={draft.autoMinHoldSec}
        onChange={(v) => set('autoMinHoldSec', v)}
        min={AUTO_MIN_HOLD_SEC}
        max={AUTO_MAX_HOLD_SEC}
        step={5}
        suffix="s"
        disabled={off}
      />
      <StepperRow
        label="Longest hold"
        value={draft.autoMaxHoldSec}
        onChange={(v) => set('autoMaxHoldSec', v)}
        min={AUTO_MIN_HOLD_SEC}
        max={AUTO_MAX_HOLD_SEC}
        step={15}
        suffix="s"
        disabled={off}
      />
      <StepperRow
        label="Between moves"
        value={draft.autoGapSec}
        onChange={(v) => set('autoGapSec', v)}
        min={0}
        max={AUTO_MAX_GAP_SEC}
        step={15}
        suffix="s"
        disabled={off}
      />
      <StepperRow
        label="Positions per move"
        value={draft.autoPositionsPerMove}
        onChange={(v) => set('autoPositionsPerMove', v)}
        min={1}
        max={AUTO_MAX_POSITIONS_PER_MOVE}
        disabled={off}
      />
      <StepperRow
        label="Volume"
        value={draft.autoVolume}
        onChange={(v) => set('autoVolume', v)}
        min={0.01}
        max={100}
        step={0.01}
        suffix="lots"
        disabled={off}
        last
      />
    </Section>
  );
}
