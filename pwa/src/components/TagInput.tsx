import { useState, useRef } from 'react';
import { useTags } from '../hooks/useTags';

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export function TagInput({ value, onChange, placeholder = '新增標籤…' }: Props) {
  const [input, setInput] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const { data: allTags = [] } = useTags();
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = input.trim()
    ? allTags.filter(
        (t) => t.toLowerCase().includes(input.toLowerCase()) && !value.includes(t)
      ).slice(0, 6)
    : [];

  function addTag(tag: string) {
    const trimmed = tag.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInput('');
    setShowDropdown(false);
    inputRef.current?.focus();
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.key === 'Enter' || e.key === ',') && input.trim()) {
      e.preventDefault();
      addTag(input.replace(/,$/, ''));
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  }

  return (
    <div className="relative">
      <div
        className="flex flex-wrap gap-1.5 p-2 border border-gray-300 rounded-lg min-h-[42px] cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-sm"
          >
            #{tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(tag); }}
              className="text-blue-500 hover:text-blue-700 text-xs"
            >
              ✕
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value); setShowDropdown(true); }}
          onKeyDown={handleKeyDown}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          placeholder={value.length === 0 ? placeholder : ''}
          className="flex-1 min-w-24 outline-none text-sm bg-transparent"
        />
        {input.trim() && (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); addTag(input); }}
            className="text-blue-600 text-sm font-semibold px-1 shrink-0"
          >
            ＋
          </button>
        )}
      </div>
      {showDropdown && suggestions.length > 0 && (
        <ul className="absolute z-10 top-full mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-md max-h-40 overflow-y-auto">
          {suggestions.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); addTag(tag); }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
              >
                #{tag}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
