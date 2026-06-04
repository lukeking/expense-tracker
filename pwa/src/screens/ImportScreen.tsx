import { useState } from 'react';
import { apiFetch, ApiError } from '../api/client';
import { AmbiguousInvoiceCard, type AmbiguousEntry, type MatchedDetail } from '../components/AmbiguousInvoiceCard';

interface ImportResult {
  filename: string | null;
  matched_exact: number;
  matched_near: number;
  ambiguous: number;
  skipped_unmatched: number;
  skipped_duplicate: number;
  skipped_voided: number;
  skipped_zero: number;
  matched: MatchedDetail[];
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
  const [ambiguousCount, setAmbiguousCount] = useState(0);
  const [exactCount, setExactCount] = useState(0);
  const [nearCount, setNearCount] = useState(0);

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
      setExactCount(data.matched_exact);
      setNearCount(data.matched_near);
      setAmbiguousCount(data.ambiguous);
      if (data.ambiguous > 0) {
        const amb = await apiFetch<{ ambiguous: AmbiguousEntry[] }>('/pwa/import/ambiguous');
        setAmbiguous(amb.ambiguous);
      } else {
        setAmbiguous([]);
      }
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
    setAmbiguousCount((n) => Math.max(0, n - 1));
    if (resolved.confidence === 'exact') setExactCount((n) => n + 1);
    else setNearCount((n) => n + 1);
  }

  function reset() {
    setFile(null);
    setResult(null);
    setError('');
    setMatched([]);
    setAmbiguous([]);
  }

  const resultRows = result
    ? [
        { label: '已配對（同日）', value: exactCount },
        { label: '已配對（鄰近）', value: nearCount },
        { label: '模糊待處理', value: ambiguousCount },
        { label: '略過（未配對）', value: result.skipped_unmatched },
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
                <AmbiguousInvoiceCard key={entry.id} entry={entry} onResolved={(r) => handleResolved(entry.id, r)} />
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

          <button
            type="button"
            onClick={reset}
            className="border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-xl py-3 font-medium"
          >
            再次匯入
          </button>
        </>
      )}
    </div>
  );
}
