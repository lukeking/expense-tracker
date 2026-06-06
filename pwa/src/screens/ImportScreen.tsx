import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../api/client';
import { AmbiguousInvoiceCard, type AmbiguousEntry, type MatchedDetail } from '../components/AmbiguousInvoiceCard';
import { ManualLinkSheet, type UnmatchedInvoice, type ManualLinkInvoice, type ManualLinkSource } from '../components/ManualLinkSheet';

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
    items: { name: string; amount: number | null; tags: string[] }[];
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

const CONFIDENCE_LABEL: Record<MatchedDetail['confidence'], string> = { exact: '同日', near: '鄰近' };
const OUTCOME_LABEL: Record<MatchedDetail['items_outcome'], string> = { filled: '已填入', kept: '保留', replaced: '已取代' };

export function ImportScreen() {
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
  const [linked, setLinked] = useState<LinkedInvoice[]>([]);
  const [unlinking, setUnlinking] = useState<string | null>(null);
  const [showRead, setShowRead] = useState(false);
  const [markingRead, setMarkingRead] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  // Per-card detail fold. Read cards collapse by default, unread expand; an explicit
  // toggle (stored by id) overrides the default.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const isExpanded = (l: LinkedInvoice) => expanded[l.id] ?? (l.reviewed_at == null);
  const toggleExpanded = (id: string, open: boolean) => setExpanded((prev) => ({ ...prev, [id]: !open }));

  // US1: the review queue shows only unacknowledged matches by default; 顯示已讀
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

  // When 顯示已讀 is on, acknowledged rows stay visible (dimmed + badge) so we flip
  // reviewed_at in place; otherwise the row leaves the unread-only list.
  const NOW = () => new Date().toISOString();

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
        if (err.code === 'INVALID_CSV') setError(`無效的 CSV 格式：${err.message}`);
        else if (err.code === 'ROW_LIMIT_EXCEEDED') setError(`${err.message}（最多 1,000 筆）`);
        else setError(err.message);
      } else {
        setError('上傳失敗，請重試');
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
        { label: '已配對（同日）', value: exactCount },
        { label: '已配對（鄰近）', value: nearCount },
        { label: '模糊待處理', value: ambiguous.length },
        { label: '略過（未配對）', value: unmatched.length },
        { label: '略過（重複）', value: result.skipped_duplicate },
        { label: '略過（作廢）', value: result.skipped_voided },
        { label: '略過（零額）', value: result.skipped_zero },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6 p-4 h-full overflow-y-auto">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">匯入電子發票 CSV</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">請上傳財政部電子發票整合服務平台匯出的 CSV 檔</p>
      </div>

      {!result ? (
        <>
          <label className="flex flex-col items-center gap-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 cursor-pointer hover:border-blue-400 transition-colors">
            <span className="text-4xl">📂</span>
            <span className="text-sm text-gray-600 dark:text-gray-300">{file ? file.name : '點擊選擇 CSV 檔案'}</span>
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
            {loading ? '處理中…' : '上傳並處理'}
          </button>

          {ambiguous.length > 0 && (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">待手動確認（{ambiguous.length}）</h3>
              {ambiguous.map((entry) => (
                <AmbiguousInvoiceCard key={entry.id} entry={entry} onResolved={(r) => handleResolved(entry.id, r)} onManualLink={() => openAmbiguousLink(entry)} />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex justify-between items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">已配對發票（可解除）</h3>
              <div className="flex items-center gap-2 shrink-0">
                {linked.some((l) => !l.reviewed_at) && (
                  <button
                    type="button"
                    onClick={handleMarkAllRead}
                    disabled={markingAll}
                    className="text-xs px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-50"
                  >
                    {markingAll ? '處理中…' : '全部標為已讀'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={toggleShowRead}
                  className={`text-xs px-2 py-1 rounded-lg border ${showRead ? 'border-blue-400 text-blue-600 dark:text-blue-400' : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}
                >
                  顯示已讀
                </button>
              </div>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">若發票配對到錯誤的交易，可在此解除連結。已確認的可標為已讀以收起。</p>
            {linked.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">{showRead ? '沒有已配對的發票。' : '沒有未讀的已配對發票。'}</p>
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
                        <p className="text-sm text-gray-800 dark:text-gray-100 truncate">{l.seller_name || '未知商家'}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                          {l.invoice_number} · NT${l.net_amount.toLocaleString()} · {l.invoice_date}
                        </p>

                        {open && hasInvoiceItems && (
                          <div className="mt-1.5">
                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">發票品項</p>
                            {l.items!.map((i, idx) => (
                              <div key={idx} className="flex justify-between gap-2 text-xs text-gray-400 dark:text-gray-500">
                                <span className="truncate">{i.name}</span>
                                <span className="shrink-0">{i.amount != null ? i.amount.toLocaleString() : '—'}</span>
                              </div>
                            ))}
                            {l.allowance > 0 && (
                              <>
                                <div className="flex justify-between gap-2 text-xs text-gray-400 dark:text-gray-500">
                                  <span>折讓</span><span className="shrink-0">−{l.allowance.toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between gap-2 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700 mt-0.5 pt-0.5">
                                  <span>淨額</span><span className="shrink-0">{l.net_amount.toLocaleString()}</span>
                                </div>
                              </>
                            )}
                          </div>
                        )}

                        {l.transaction && (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                            → 交易 NT${l.transaction.amount.toLocaleString()}
                            {l.transaction.tags.length > 0 ? ` · ${l.transaction.tags.join('/')}` : ''}
                            {l.transaction.note ? ` · ${l.transaction.note}` : ''}
                          </p>
                        )}

                        {open && hasTxItems && (
                          <div className="mt-1">
                            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">交易品項</p>
                            {l.transaction!.items.map((i, idx) => {
                              const cat = i.tags.find((t) => t.includes(':')) ?? i.tags[0];
                              return (
                                <div key={idx} className="flex justify-between gap-2 text-xs text-gray-400 dark:text-gray-500">
                                  <span className="truncate">{i.name}{cat ? ` #${cat}` : ''}</span>
                                  <span className="shrink-0">{i.amount != null ? i.amount.toLocaleString() : '—'}</span>
                                </div>
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
                            {open ? '收合 ▴' : '展開 ▾'}
                          </button>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {l.reviewed_at ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">✓ 已讀</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleMarkRead(l.id)}
                            disabled={markingRead === l.id}
                            className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 disabled:opacity-50"
                          >
                            {markingRead === l.id ? '處理中…' : '已讀'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleUnlink(l.id)}
                          disabled={unlinking === l.id}
                          className="text-xs px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 disabled:opacity-50"
                        >
                          {unlinking === l.id ? '解除中…' : '解除'}
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
            <p className="text-sm font-medium text-green-800 dark:text-green-300 mb-1">匯入完成</p>
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
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">待手動確認（{ambiguous.length}）</h3>
              {ambiguous.map((entry) => (
                <AmbiguousInvoiceCard key={entry.id} entry={entry} onResolved={(r) => handleResolved(entry.id, r)} onManualLink={() => openAmbiguousLink(entry)} />
              ))}
            </div>
          )}

          {matched.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">已配對（{matched.length}）</h3>
              <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                {matched.map((m) => (
                  <div key={m.invoice_number} className="flex justify-between items-center px-4 py-3 border-b border-gray-50 dark:border-gray-700 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 dark:text-gray-100 truncate">{m.seller_name || '未知商家'}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{m.invoice_number} · NT${m.amount.toLocaleString()}</p>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">{CONFIDENCE_LABEL[m.confidence]}</span>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">項目{OUTCOME_LABEL[m.items_outcome]}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {unmatched.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">略過·未配對（{unmatched.length}）</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500">找不到金額與日期相符的交易。可手動連結到既有交易（否則不會被儲存）。</p>
              <div className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl overflow-hidden">
                {unmatched.map((u) => (
                  <div key={u.invoice_number} className="flex justify-between items-center gap-2 px-4 py-3 border-b border-gray-50 dark:border-gray-700 last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 dark:text-gray-100 truncate">{u.seller_name || '未知商家'}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
                        {u.invoice_number} · NT${u.net_amount.toLocaleString()} · {u.invoice_date.slice(0, 10)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openUnmatchedLink(u)}
                      className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400"
                    >
                      手動連結
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
            再次匯入
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
    </div>
  );
}
