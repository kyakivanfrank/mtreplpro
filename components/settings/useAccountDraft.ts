import { useEffect, useMemo, useState } from 'react';
import { accountStore, BUILT_IN_SUFFIXES, type AccountConfig } from '@/lib/account';
import { deleteAllLocalData, storageStatus, type StorageStatus } from '@/lib/db';
import { marketStore } from '@/lib/market/store';
import { accountSummary } from '@/lib/trading/math';
import { tradingStore, useBook } from '@/lib/trading/store';

const DEFAULT_SUFFIX = 'm';

/**
 * The settings sheet's state and the rules for committing it.
 *
 * Edits are held in a local draft and only committed on Save, so backing out leaves the running
 * config untouched — the same contract as MT5's own settings sheets.
 */
export function useAccountDraft(open: boolean, config: AccountConfig, onClose: () => void) {
  const [draft, setDraft] = useState<AccountConfig>(config);
  const [customSuffix, setCustomSuffix] = useState('');
  const [typeOpen, setTypeOpen] = useState(false);

  /* ---------- funds ---------- */
  const book = useBook();
  const [balanceDraft, setBalanceDraft] = useState('');
  const [fundsError, setFundsError] = useState<string | null>(null);

  // Informational only — the withdrawal limit is re-checked against live prices on Save.
  const summary = accountSummary(book.balance, book.positions, marketStore.getQuotes());

  // Reopening always starts from what's actually saved, never a stale draft.
  useEffect(() => {
    if (open) {
      setDraft(config);
      setCustomSuffix('');
      setTypeOpen(false);
      setBalanceDraft(book.balance.toFixed(2));
      setFundsError(null);
    }
    // Deliberately not keyed on the balance: it ticks with every close, and re-seeding the
    // field mid-edit would overwrite what the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config]);

  /* ---------- local data ---------- */
  const [storage, setStorage] = useState<StorageStatus>({
    supported: false,
    persistent: false,
    usage: 0,
    quota: 0,
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    void storageStatus().then(setStorage);
  }, [open]);

  // Built-ins plus whatever the user has added — one flat list for the dropdown.
  const suffixOptions = useMemo(
    () => [
      ...BUILT_IN_SUFFIXES,
      ...draft.customSuffixes.map((value) => ({ value, label: value, note: value })),
    ],
    [draft.customSuffixes]
  );

  const selectedOption =
    suffixOptions.find((option) => option.value === draft.symbolSuffix) ??
    { value: draft.symbolSuffix, label: draft.symbolSuffix, note: draft.symbolSuffix };

  const set = <K extends keyof AccountConfig>(key: K, value: AccountConfig[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const addCustomSuffix = () => {
    const value = customSuffix.trim();
    if (!value) return;

    setDraft((prev) => ({
      ...prev,
      customSuffixes: prev.customSuffixes.includes(value)
        ? prev.customSuffixes
        : [...prev.customSuffixes, value],
      symbolSuffix: value,
    }));
    setCustomSuffix('');
  };

  const removeCustomSuffix = (value: string) =>
    setDraft((prev) => ({
      ...prev,
      customSuffixes: prev.customSuffixes.filter((s) => s !== value),
      // Don't leave the account pointing at a suffix that no longer exists.
      symbolSuffix: prev.symbolSuffix === value ? DEFAULT_SUFFIX : prev.symbolSuffix,
    }));

  /**
   * Start over: clear everything stored, then immediately fetch it again.
   *
   * Deliberately not a bare delete — wiping the archives used to leave the app empty with a
   * reload to sit through, which is the one state this terminal is built never to be in. Two
   * taps, because it still destroys the account along with the data.
   */
  const resetData = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    // Books first: it cancels the pending server sync and clears the server's copy, so nothing
    // can write the deleted account back a moment later.
    await tradingStore.wipe();
    await deleteAllLocalData();
    accountStore.reset();

    // Re-queues a full download for every symbol currently tracked.
    await marketStore.resetData();
    onClose();
  };

  const save = () => {
    /*
     * Whether the amount was edited is decided against what the *user was looking at* — the
     * balance on screen when they opened this sheet. An untouched field is not an edit.
     */
    const target = Number.parseFloat(balanceDraft);
    const editedFunds =
      Number.isFinite(target) && target >= 0 && Math.abs(target - book.balance) >= 0.005;

    /*
     * Identity first, amount second, and the order is the whole point.
     *
     * The account number decides which book everything else lands in. Saving it here switches
     * the trading store synchronously, so the `setBalance` below applies to the account being
     * *arrived at*.
     *
     * This used to run the other way round, to keep a refused withdrawal from leaving the naming
     * settings half-written. That guarded the wrong thing: a user who changed the number and the
     * amount together deposited into the account they were leaving. A rejection now leaves the
     * switch standing and the sheet open on the error, which is recoverable; money in the wrong
     * account is not.
     */
    accountStore.save(draft);

    if (editedFunds) {
      // Checked against the incoming account's own positions and free margin, which is the only
      // account the check could honestly be about.
      const result = tradingStore.setBalance(target);
      if (!result.ok) {
        setFundsError(result.error);
        return;
      }
    }

    onClose();
  };

  return {
    draft,
    set,
    summary,
    balanceDraft,
    setBalanceDraft,
    fundsError,
    setFundsError,
    book,
    storage,
    confirmDelete,
    resetData,
    save,
    typeOpen,
    setTypeOpen,
    customSuffix,
    setCustomSuffix,
    suffixOptions,
    selectedOption,
    addCustomSuffix,
    removeCustomSuffix,
  };
}
