import { useState } from 'react';
import { apiFetch, ApiError } from '../api/client';

interface ImportResult {
  filename: string;
  matched_count: number;
  auto_created_count: number;
  skipped_duplicate_count: number;
  held_forex_count: number;
  ambiguous_count: number;
  skipped_voided_count: number;
  parse_failed_count: number;
}

export function ImportScreen() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
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
      const data = await apiFetch<ImportResult>('/pwa/import', {
        method: 'POST',
        body: formData,
      });
      setResult(data);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'INVALID_CSV') {
          setError(`無效的 CSV 格式：${err.message}`);
        } else if (err.code === 'ROW_LIMIT_EXCEEDED') {
          setError(`${err.message}（最多 1,000 筆）`);
        } else {
          setError(err.message);
        }
      } else {
        setError('上傳失敗，請重試');
      }
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setFile(null);
    setResult(null);
    setError('');
  }

  const RESULT_ROWS = result
    ? [
        { label: '已配對', value: result.matched_count },
        { label: '自動建立', value: result.auto_created_count },
        { label: '略過（重複）', value: result.skipped_duplicate_count },
        { label: '略過（作廢）', value: result.skipped_voided_count },
        { label: '待處理（外幣）', value: result.held_forex_count },
        { label: '模糊配對', value: result.ambiguous_count },
        { label: '解析失敗', value: result.parse_failed_count },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6 p-4 h-full overflow-y-auto">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">匯入電子發票 CSV</h2>
        <p className="text-sm text-gray-500 mt-1">請上傳財政部電子發票整合服務平台匯出的 CSV 檔</p>
      </div>

      {!result ? (
        <>
          <label className="flex flex-col items-center gap-3 border-2 border-dashed border-gray-300 rounded-xl p-8 cursor-pointer hover:border-blue-400 transition-colors">
            <span className="text-4xl">📂</span>
            <span className="text-sm text-gray-600">
              {file ? file.name : '點擊選擇 CSV 檔案'}
            </span>
            {file && (
              <span className="text-xs text-gray-400">
                {(file.size / 1024).toFixed(1)} KB
              </span>
            )}
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
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
          <div className="bg-green-50 border border-green-200 rounded-xl p-4">
            <p className="text-sm font-medium text-green-800 mb-1">匯入完成</p>
            <p className="text-xs text-green-600 truncate">{result.filename}</p>
          </div>

          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            {RESULT_ROWS.map((row) => (
              <div key={row.label} className="flex justify-between px-4 py-3 border-b border-gray-50 last:border-0">
                <span className="text-sm text-gray-700">{row.label}</span>
                <span className={`text-sm font-semibold ${row.value > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                  {row.value}
                </span>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={reset}
            className="border border-gray-300 text-gray-700 rounded-xl py-3 font-medium"
          >
            再次匯入
          </button>
        </>
      )}
    </div>
  );
}
