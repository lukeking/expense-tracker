import type { CategorySelection } from '../components/CategoryPicker';

// Parse a stored `主:子` category tag into a CategorySelection. A colon-less value is
// treated as a major-only selection. Shared by the Entry screen (parent auto-fill) and
// the Edit sheets so the parse lives in exactly one place.
export function parseCategorySelection(tag: string | null): CategorySelection | null {
  if (!tag) return null;
  const idx = tag.indexOf(':');
  if (idx === -1) return { major: tag, subcategory: null };
  return { major: tag.slice(0, idx), subcategory: tag.slice(idx + 1) };
}
