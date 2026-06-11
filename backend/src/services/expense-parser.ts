export interface ParsedTags {
  plainTags: string[];
  sharedCategory: string | null;
  error: string | null;
}

export interface ParsedItems {
  items: { name: string; amount: number | undefined; tags: string[] }[];
  warnings: string[];
  error: string | null;
}

function parseLineItem(token: string): { name: string; amount: number } | null {
  const words = token.split(/\s+/);
  if (words.length < 2) return null;
  const lastWord = words[words.length - 1];
  const num = Number(lastWord);
  if (!isNaN(num) && isFinite(num) && lastWord.trim() !== '') {
    return { name: words.slice(0, -1).join(' '), amount: num };
  }
  return null;
}

function parseTaggedItemRest(rest: string): { name: string; amount: number | undefined } {
  const trimmed = rest.trim();
  if (!trimmed) return { name: trimmed, amount: undefined };
  const words = trimmed.split(/\s+/);
  const lastWord = words[words.length - 1];
  const num = Number(lastWord);
  if (words.length >= 2 && !isNaN(num) && isFinite(num) && lastWord.trim() !== '') {
    return { name: words.slice(0, -1).join(' '), amount: num };
  }
  return { name: trimmed, amount: undefined };
}

export function parseTags(tagsStr: string | null | undefined): ParsedTags {
  if (!tagsStr?.trim()) return { plainTags: [], sharedCategory: null, error: null };

  const tokens = tagsStr.split(',').map((t) => t.trim()).filter(Boolean);
  const plainTags: string[] = [];
  let sharedCategory: string | null = null;

  for (const token of tokens) {
    if (!token.startsWith('#')) {
      return { plainTags, sharedCategory, error: `tags 欄位只接受 #標籤 格式，無效：${token}` };
    }
    const tagBody = token.slice(1);
    if (!tagBody) continue;
    if (tagBody.includes(':')) {
      if (sharedCategory !== null) {
        return { plainTags, sharedCategory, error: `tags 欄位只能有一個分類標籤，多餘：#${tagBody}` };
      }
      sharedCategory = tagBody;
    } else {
      plainTags.push(tagBody);
    }
  }

  return { plainTags, sharedCategory, error: null };
}

export function parseItems(
  descriptionStr: string | null | undefined,
  totalAmount: number,
  sharedCategory: string | null
): ParsedItems {
  if (!descriptionStr?.trim()) {
    if (sharedCategory !== null) {
      const subcategory = sharedCategory.split(':')[1] ?? '';
      if (subcategory.trim().length > 0) {
        // B2: the category lives on the transaction; the synthesized item keeps the
        // subcategory-derived name but inherits (no tag copy).
        return {
          items: [{ name: subcategory, amount: totalAmount, tags: [] }],
          warnings: [],
          error: null,
        };
      }
    }
    return { items: [], warnings: [], error: null };
  }

  const tokens = descriptionStr.split(',').map((t) => t.trim()).filter(Boolean);
  const items: { name: string; amount: number | undefined; tags: string[] }[] = [];
  let hasBareTag = false;

  for (const token of tokens) {
    if (token.startsWith('#')) {
      const spaceIdx = token.indexOf(' ');
      const tagBody = spaceIdx === -1 ? token.slice(1) : token.slice(1, spaceIdx);
      const rest = spaceIdx === -1 ? '' : token.slice(spaceIdx + 1).trim();

      if (!tagBody.includes(':')) {
        return {
          items,
          warnings: [],
          error: `description 欄位不接受 #${tagBody}，請將商店標籤移至 tags 欄位`,
        };
      }

      if (rest.length === 0) {
        hasBareTag = true;
        const subcategory = tagBody.split(':')[1] ?? '';
        // B2: an item tag equal to the shared (tx-level) category collapses to inherit.
        items.push({ name: subcategory || tagBody, amount: undefined, tags: tagBody === sharedCategory ? [] : [tagBody] });
      } else {
        const parsed = parseTaggedItemRest(rest);
        items.push({ name: parsed.name, amount: parsed.amount, tags: tagBody === sharedCategory ? [] : [tagBody] });
      }
    } else {
      const lineItem = parseLineItem(token);
      // B2: untagged items inherit the tx-level category — no copy stored.
      if (lineItem !== null) {
        items.push({ name: lineItem.name, amount: lineItem.amount, tags: [] });
      } else {
        items.push({ name: token, amount: undefined, tags: [] });
      }
    }
  }

  if (hasBareTag && items.length > 1) {
    return {
      items: [],
      warnings: [],
      error: '純分類標籤 (#x:y) 不能與其他項目混用，請指定項目名稱',
    };
  }

  if (items.length === 1 && items[0].amount === undefined) {
    items[0] = { ...items[0], amount: totalAmount };
  }

  const knownTotal = items.reduce((sum, i) => sum + (i.amount ?? 0), 0);
  if (knownTotal > totalAmount) {
    return {
      items,
      warnings: [],
      error: `項目合計 NT$${knownTotal} 超過總金額 NT$${totalAmount}，請檢查金額`,
    };
  }

  return { items, warnings: [], error: null };
}
