import { useEffect, useState } from 'react';
import { apiFetch, ApiError, assignItemCategory } from '../api/client';
import { AmbiguousInvoiceCard, type AmbiguousEntry, type MatchedDetail } from '../components/AmbiguousInvoiceCard';
import { ManualLinkSheet, type UnmatchedInvoice, type ManualLinkInvoice, type ManualLinkSource } from '../components/ManualLinkSheet';
import { ItemCategorySheet } from '../components/ItemCategorySheet';
import { itemCategoryTag, effectiveItemCategory } from '../lib/itemCategory';
import { useT } from '../i18n';
import type { MessageKey } from '../i18n';

interface LinkedInvoice {
  id: string;
  invoice_number: string;
  seller_name: string | null;
  invoice_date: string;
  net_amount: number;
  allowance: number;
  match_confidence: 'exact' | 'near' | null;
  reviewed_at: string | null;
  items: { name: string; amount: number }[] | null;
  transaction: {
    id: string;
    amount: number;
    transaction_at: string;
    note: string | null;
    tags: string[];
    items: { id: string; name: string; amount: number | null; tags: string[] }[];
  } | null;
}

interface ImportResult {
  filename: string | null;
  import_run_id: string;
  matched_exact: number;
  matched_near: number;
  ambiguous: number;
  skipped_unmatched: number;
  skipped_duplicate: number;
  skipped_voided: number;
  skipped_zero: number;
  matched: MatchedDetail[];
  skipped_unmatched_detail: UnmatchedInvoice[];
}

const CONFIDENCE_LABEL_KEYS: Record<MatchedDetail['confidence'], MessageKey> = { exact: 'import.confExact', near: 'import.confNear' };
const OUTCOME_LABEL_KEYS: Record<MatchedDetail['items_outcome'], MessageKey> = { filled: 'import.outcomeFilled', kept: 'import.outcomeKept', replaced: 'import.outcomeReplaced' };

export function ImportScreen() {
  const t = useT();
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [matched, setMatched] = useState<MatchedDetail[]>([]);
  const [ambiguous, setAmbiguous] = useState<AmbiguousEntry[]>([]);
  const [exactCount, setExactCount] = useState(0);
  const [nearCount, setNearCount] = useState(0);
  const [unmatched, setUnmatched] = useState<UnmatchedInvoice[]>([]);
  const [linkTarget, setLinkTarget] = useState<{ invoice: ManualLinkInvoice; source: ManualLinkSource } | null>(null);
  // Feature 026: the item whose category is being assigned inline from the review list.
  const [catTarget, setCatTarget] = useState<{ txId: string; itemId: string; value: string | null; inheritedTag: string | null } | null>(null);
  const [linked, setLinked] = useState<LinkedInvoice[]>([]);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [rematching, setRematching] = useState<string | null>(null);
  const [showRead, setShowRead] = useState(false);
  const [markingRead, setMarkingRead] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  // Per-card detail fold. Read cards collapse by default, unread expand; an explicit
  // toggle (stored by id) overrides the default.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isExpanded = (l: LinkedInvoice) => expanded[l.id] ?? (l.reviewed_at == null);
  const toggleExpanded = (id: string, open: boolean) => setExpanded((prev) => ({ ...prev, [id]: !open }));

  // US1: the review queue shows only unacknowledged matches by default; the 'Show read' toggle
  // refetches with include_read=true to reveal acknowledged (still un-linkable) ones.
  async function loadLinked(includeRead = showRead) {
    try {
      const qs = includeRead ? '?include_read=true' : '';
      const data = await apiFetch<{ matched: LinkedInvoice[] }>(`/pwa/import/matched${qs}`);
      setLinked(data.matched);
    } catch {
      // Non-critical: the management list just stays empty if it fails to load.
    }
  }

  // Always load the full ambiguous backlog (incl. invoices held by earlier imports),
  // not just what the current run produced — otherwise leftovers are orphaned.
  async function loadAmbiguous() {
    try {
      const data = await apiFetch<{ ambiguous: AmbiguousEntry[] }>('/pwa/import/ambiguous');
      setAmbiguous(data.ambiguous);
    } catch {
      // Non-critical: the list just stays empty if it fails to load.
    }
  }

  useEffect(() => {
    loadLinked();
    loadAmbiguous();
  }, []);

  async function handleUnlink(invoiceId: string) {
    setUnlinking(invoiceId);
    try {
      await apiFetch('/pwa/import/unlink', {
        method: 'POST',
        body: JSON.stringify({ invoice_id: invoiceId }),
      });
      setLinked((prev) => prev.filter((l) => l.id !== invoiceId));
    } catch {
      // Leave the row in place on failure so the user can retry.
    } finally {
      setUnlinking(null);
    }
  }

  // When 'Show read' is on, acknowledged rows stay visible (dimmed + badge) so we flip
  // reviewed_at in place; otherwise the row leaves the unread-only list.
  const NOW = () => new Date().toISOString();

  // Rematch: detach the (wrong) transaction and send the invoice back to the manual-confirm
  // queue, where it can be re-linked without re-importing.
  async function handleRematch(invoiceId: string) {
    setRematching(invoiceId);
    try {
      await apiFetch('/pwa/import/rematch', {
        method: 'POST',
        body: JSON.stringify({ invoice_id: invoiceId }),
      });
      setLinked((prev) => prev.filter((l) => l.id !== invoiceId));
      loadAmbiguous();
    } catch {
      // Leave the row in place on failure so the user can retry.
    } finally {
      setRematching(null);
    }
  }

  async function handleMarkRead(invoiceId: string) {
    setMarkingRead(invoiceId);
    try {
      await apiFetch('/pwa/import/mark-read', {
        method: 'POST',
        body: JSON.stringify({ invoice_id: invoiceId }),
      });
      setLinked((prev) =>
        showRead
          ? prev.map((l) => (l.id === invoiceId ? { ...l, reviewed_at: NOW() } : l))
          : prev.filter((l) => l.id !== invoiceId)
      );
    } catch {
      // Leave the row in place on failure so the user can retry.
    } finally {
      setMarkingRead(null);
    }
  }

  async function handleMarkAllRead() {
    const ids = linked.filter((l) => !l.reviewed_at).map((l) => l.id);
    if (ids.length === 0) return;
    setMarkingAll(true);
    try {
      await apiFetch('/pwa/import/mark-read', {
        method: 'POST',
        body: JSON.stringify({ invoice_ids: ids }),
      });
      setLinked((prev) =>
        showRead
          ? prev.map((l) => (l.reviewed_at ? l : { ...l, reviewed_at: NOW() }))
          : []
      );
    } catch {
      // Leave the rows in place on failure so the user can retry.
    } finally {
      setMarkingAll(false);
    }
  }

  function toggleShowRead() {
    const next = !showRead;
    setShowRead(next);
    loadLinked(next);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setResult(null);
    setError('');
  }

  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await apiFetch<ImportResult>('/pwa/import', { method: 'POST', body: formData });
      setResult(data);
      setMatched(data.matched);
      setUnmatched(data.skipped_unmatched_detail);
      setExactCount(data.matched_exact);
      setNearCount(data.matched_near);
      loadAmbiguous();
      loadLinked();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'INVALID_CSV') setError(t('import.invalidCsv', { msg: err.message }));
        else if (err.code === 'ROW_LIMIT_EXCEEDED') setError(t('import.rowLimit', { msg: err.message }));
        else setError(err.message);
      } else {
        setError(t('import.uploadFailed'));
      }
    } finally {
      setLoading(false);
    }
  }

  function handleResolved(entryId: string, resolved: MatchedDetail) {
    setAmbiguous((prev) => prev.filter((e) => e.id !== entryId));
    setMatched((prev) => [...prev, resolved]);
    if (resolved.confidence === 'exact') setExactCount((n) => n + 1);
    else setNearCount((n) => n + 1);
  }

  function openUnmatchedLink(u: UnmatchedInvoice) {
    setLinkTarget({
      invoice: {
        invoice_number: u.invoice_number,
        seller_name: u.seller_name,
        invoice_date: u.invoice_date,
        net_amount: u.net_amount,
        items: u.items.map((i) => ({ name: i.name, amount: i.amount })),
      },
      source: { kind: 'unmatched', payload: u, importRunId: result!.import_run_id },
    });
  }

  function openAmbiguousLink(entry: AmbiguousEntry) {
    setLinkTarget({
      invoice: {
        invoice_number: entry.invoice_number,
        seller_name: entry.seller_name,
        invoice_date: entry.invoice_date,
        net_amount: entry.net_amount,
        items: (entry.items ?? []).map((i) => ({ name: i.name, amount: i.amount })),
      },
      source: { kind: 'ambiguous', invoiceId: entry.id },
    });
  }

  function handleLinked(resolved: MatchedDetail) {
    setUnmatched((prev) => prev.filter((u) => u.invoice_number !== resolved.invoice_number));
    setAmbiguous((prev) => prev.filter((e) => e.invoice_number !== resolved.invoice_number));
    setMatched((prev) => [...prev, resolved]);
    if (resolved.confidence === 'exact') setExactCount((n) => n + 1);
    else setNearCount((n) => n + 1);
    setLinkTarget(null);
    loadLinked();
  }

  // Feature 026: assign the chosen category to catTarget's item, then reflect the new
  // tags locally so the uncategorized flag updates without a refetch.
  // Feature 027 (B2): mirror the server's collapse rule — picking the tx's own
  // category stores nothing (inherit), so the local state must do the same.
  async function handleAssignCategory(tag: string | null) {
    if (!catTarget) return;
    const { txId, itemId } = catTarget;
    const effective = tag !== null && tag === catTarget.inheritedTag ? null : tag;
    try {
      await assignItemCategory(txId, itemId, tag);
      setLinked((prev) =>
        prev.map((l) =>
          l.transaction && l.transaction.id === txId
            ? {
                ...l,
                transaction: {
                  ...l.transaction,
                  items: l.transaction.items.map((it) =>
                    it.id === itemId
                      ? { ...it, tags: effective ? [...it.tags.filter((t) => !t.includes(':')), effective] : it.tags.filter((t) => !t.includes(':')) }
                      : it
                  ),
                },
              }
            : l
        )
      );
    } catch {
      // Leave as-is on failure; the user can retry.
    }
  }

  function reset() {
    setFile(null);
    setResult(null);
    setError('');
    setMatched([]);
    setUnmatched([]);
    // Keep the persistent backlogs visible; refresh them.
    loadAmbiguous();
    loadLinked();
  }

  const resultRows = result
    ? [
        { label: t('import.rowMatchedExact'), value: exactCount },
        { label: t('import.rowMatchedNear'), value: nearCount },
        { label: t('import.rowAmbiguous'), value: ambiguous.length },
        { label: t('import.rowSkipUnmatched'), value: unmatched.length },
        { label: t('import.rowSkipDuplicate'), value: result.skipped_duplicate },
        { label: t('import.rowSkipVoided'), value: result.skipped_voided },
        { label: t('import.rowSkipZero'), value: result.skipped_zero },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6 p-4 h-full overflow-y-auto">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('import.title')}</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('import.subtitle')}</p>
      </div>

      {!result ? (
        <>
          <label className="flex flex-col items-center gap-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 cursor-pointer hover:border-blue-400 transition-colors">
            <span className="text-4xl">📂</span>
            <span className="text-sm text-gray-600 dark:text-gray-300">{file ? file.name : t('import.pickFile')}</span>
            {file && <span className="text-xs text-gray-400 dark:text-gray-500">{(file.size / 1024).toFixed(1)} KB</span>}
            <input type="file" accept=".csv,text/csv" onChange={handleFileChange} className="hidden" />
          </label>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          <button
            type="button"
            onClick={handleUpload}
            disabled={!file || loading}
            className="bg-blue-600 text-white rounded-xl py-3 font-semibold disabled:opacity-50"
          >
            {loading ? t('common.processing') : t('import.uploadProcess')}
          </button>

          {ambiguous.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('import.pendingManual', { n: ambiguous.length })}</h3>
              {ambiguous.map((entry) => (
                <AmbiguousInvoiceCard key={entry.id} entry={entry} onResolved={(r) => handleResolved(entry.id, r)} onManualLink={() => openAmbiguousLink(entry)} />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('import.linkedInvoices')}</h3>
              <div className="flex items-center gap-2 shrink-0">
                {linked.some((l) => !l.reviewed_at) && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    disabled={markingAll}
                    className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-50"
                  >
                    {markingAll ? t('common.processing') : t('import.markAllRead')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleShowRead}
                  className={`text-xs px-2 py-1 rounded-lg border ${showRead ? 'border-blue-400 text-blue-600 dark:text-blue-400' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}
                >
                  {t('import.showRead')}
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">{t('import.linkedHint')}</p>
            {linked.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">{showRead ? t('import.noMatchedAll') : t('import.noMatchedUnread')}</p>
            ) : (
              <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                {linked.map((l) => {
                  const open = isExpanded(l);
                  const hasInvoiceItems = !!(l.items && l.items.length > 0);
                  const hasTxItems = !!(l.transaction && l.transaction.items.length > 0);
                  const foldable = hasInvoiceItems || hasTxItems;
                  return (
                    <div key={l.id} className={`flex justify-between items-start gap-2 px-4 py-3 border-b border-gray-50 dark:border-gray-700 last:border-0 ${l.reviewed_at ? 'opacity-60' : ''}`}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-gray-800 dark:text-gray-100 truncate">{l.seller_name || t('import.unknownSeller')}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                          {l.invoice_number} · NT${l.net_amount.toLocaleString()} · {l.invoice_date}
                        </p>

                        {open && hasInvoiceItems && (
                          <div className="mt-1.5">
                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('import.invoiceItems')}</p>
                            {l.items!.map((i, idx) => (
                              <div key={idx} className="flex justify-between gap-2 text-xs text-gray-400 dark:text-gray-500">
                                <span className="truncate">{i.name}</span>
                                <span className="shrink-0">{i.amount != null ? i.amount.toLocaleString() : '—'}</span>
                              </div>
                            ))}
                            {l.allowance > 0 && (
                              <>
                                <div className="flex justify-between gap-2 text-xs text-gray-400 dark:text-gray-500">
                                  <span>{t('import.allowance')}</span><span className="shrink-0">−{l.allowance.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between gap-2 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700 mt-0.5 pt-0.5">
                                  <span>{t('import.netAmount')}</span><span className="shrink-0">{l.net_amount.toLocaleString()}</span>
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {l.transaction && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                            → {t('import.transaction')} NT${l.transaction.amount.toLocaleString()}
                            {l.transaction.tags.length > 0 ? ` · ${l.transaction.tags.join('/')}` : ''}
                            {l.transaction.note ? ` · ${l.transaction.note}` : ''}
                          </p>
                        )}

                        {open && hasTxItems && (
                          <div className="mt-1">
                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('import.txItems')}</p>
                            {l.transaction!.items.map((i) => {
                              const cat = itemCategoryTag(i);
                              // B2 (FR-011): blue = own decision (override / sentinel-as-'Other'),
                              // pale gray = inherited live from the tx, amber = no decision.
                              const eff = effectiveItemCategory(i, l.transaction!);
                              return (
                                <button
                                  key={i.id}
                                  type="button"
                                  onClick={() => setCatTarget({
                                    txId: l.transaction!.id,
                                    itemId: i.id,
                                    value: cat,
                                    inheritedTag: l.transaction!.tags.find((t) => t.includes(':')) ?? null,
                                  })}
                                  className="w-full flex justify-between gap-2 text-xs text-left"
                                >
                                  <span className="truncate text-gray-400 dark:text-gray-500">
                                    {i.name}
                                    {eff.source === 'override' || eff.source === 'explicit-uncategorized' ? (
                                      <span className="text-blue-500 dark:text-blue-400"> #{eff.tag}</span>
                                    ) : eff.source === 'inherited' ? (
                                      <span className="text-gray-300 dark:text-gray-600"> #{eff.tag}</span>
                                    ) : (
                                      <span className="text-amber-600 dark:text-amber-400">{t('summary.uncategorized')}</span>
                                    )}
                                  </span>
                                  <span className="shrink-0 text-gray-400 dark:text-gray-500">{i.amount != null ? i.amount.toLocaleString() : '—'}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}

                        {foldable && (
                          <button
                            type="button"
                            onClick={() => toggleExpanded(l.id, open)}
                            className="text-xs text-blue-600 dark:text-blue-400 mt-1.5"
                          >
                            {open ? t('import.collapse') : t('import.expand')}
                          </button>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {l.reviewed_at ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">{t('import.readBadge')}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleMarkRead(l.id)}
                            disabled={markingRead === l.id}
                            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-50"
                          >
                            {markingRead === l.id ? t('common.processing') : t('import.markRead')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleRematch(l.id)}
                          disabled={rematching === l.id}
                          className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 disabled:opacity-50"
                        >
                          {rematching === l.id ? t('common.processing') : t('import.rematch')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUnlink(l.id)}
                          disabled={unlinking === l.id}
                          className="text-xs px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 disabled:opacity-50"
                        >
                          {unlinking === l.id ? t('import.unlinking') : t('import.unlink')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-xl p-4">
            <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-1">{t('import.importComplete')}</p>
            <p className="text-xs text-green-600 dark:text-green-400 truncate">{result.filename}</p>
          </div>

          <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
            {resultRows.map((row) => (
              <div key={row.label} className="flex justify-between px-4 py-3 border-b border-gray-50 dark:border-gray-700 last:border-0">
                <span className="text-sm text-gray-700 dark:text-gray-200">{row.label}</span>
                <span className={`text-sm font-semibold ${row.value > 0 ? 'text-gray-900 dark:text-white' : 'text-gray-300 dark:text-gray-600'}`}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          {ambiguous.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('import.pendingManual', { n: ambiguous.length })}</h3>
              {ambiguous.map((entry) => (
                <AmbiguousInvoiceCard key={entry.id} entry={entry} onResolved={(r) => handleResolved(entry.id, r)} onManualLink={() => openAmbiguousLink(entry)} />
              ))}
            </div>
          )}

          {matched.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('import.matchedCount', { n: matched.length })}</h3>
              <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                {matched.map((m) => (
                  <div key={m.invoice_number} className="flex justify-between items-center px-4 py-3 border-b border-gray-50 dark:border-gray-700 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 dark:text-gray-100 truncate">{m.seller_name || t('import.unknownSeller')}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{m.invoice_number} · NT${m.amount.toLocaleString()}</p>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">{t(CONFIDENCE_LABEL_KEYS[m.confidence])}</span>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t('import.itemPrefix')}{t(OUTCOME_LABEL_KEYS[m.items_outcome])}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {unmatched.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t('import.skipUnmatchedCount', { n: unmatched.length })}</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500">{t('import.unmatchedHint')}</p>
              <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                {unmatched.map((u) => (
                  <div key={u.invoice_number} className="flex justify-between items-center gap-2 px-4 py-3 border-b border-gray-50 dark:border-gray-700 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 dark:text-gray-100 truncate">{u.seller_name || t('import.unknownSeller')}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                        {u.invoice_number} · NT${u.net_amount.toLocaleString()} · {u.invoice_date.slice(0, 10)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openUnmatchedLink(u)}
                      className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400"
                    >
                      {t('import.manualLink')}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={reset}
            className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-xl py-3 font-medium"
          >
            {t('import.importAgain')}
          </button>
        </>
      )}

      {linkTarget && (
        <ManualLinkSheet
          invoice={linkTarget.invoice}
          source={linkTarget.source}
          onClose={() => setLinkTarget(null)}
          onLinked={handleLinked}
        />
      )}

      {catTarget && (
        <ItemCategorySheet
          open
          onClose={() => setCatTarget(null)}
          value={catTarget.value}
          inheritedTag={catTarget.inheritedTag}
          onSelect={handleAssignCategory}
        />
      )}
    </div>
  );
}
