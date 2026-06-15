// Traditional Chinese (zh ≡ zh-TW) — base catalog and single source of truth for the key set.
// Strings are the verbatim current UI wording; do not reword (FR-008).
// Keys are added per migration phase, grouped by area (common.* / nav.* / settings.* / entry.* …).
export const zh = {
  'common.loading': '載入中…',

  'nav.entry': '記帳',
  'nav.summary': '統計',
  'nav.budget': '預算',
  'nav.import': '匯入',
  'nav.settings': '設定',

  'settings.title': '設定',
  'settings.language': '語系',
  'settings.theme': '主題',
  'settings.themeLight': '☀️ 淺色',
  'settings.themeDark': '🌙 深色',
  'settings.langZh': '中文',
  'settings.langEn': 'English',

  'entry.tabExpense': '支出',
  'entry.tabFee': '手續費',
  'entry.tabRefund': '退款',
  'entry.amountLabel': '金額 (NTD)',
  'entry.adjAria': '折抵設定',
  'entry.paymentMethod': '付款方式',
  'entry.category': '分類',
  'entry.tags': '標籤',
  'entry.addAdjustment': '＋ 新增折抵',
  'entry.itemDetails': '品項明細',
  'entry.itemRequired': '請至少新增一個品項',
  'entry.addItem': '＋ 新增品項',
  'entry.itemSubtotal': '品項合計',
  'entry.computedPaid': '計算實付',
  'entry.paidDiff': ' ⚠ 差 NT${n}',
  'entry.note': '備註',
  'entry.notePlaceholder': '可不填',
  'entry.description': '說明',
  'entry.feeDescPlaceholder': '國外交易服務費',
  'entry.linkOriginal': '連結原始交易（可選）',
  'entry.refundDescPlaceholder': '如：訂單退款',
  'entry.refundTo': '退款至',
  'entry.submit': '送出',
  'entry.submitting': '送出中…',
  'entry.toastExpenseSaved': '記錄成功！',
  'entry.toastFeeSaved': '手續費已記錄',
  'entry.toastRefundSaved': '退款已記錄',

  'common.remove': '移除',
  'common.searching': '搜尋中…',

  'payment.cash': '現金',
  'payment.creditCard': '信用卡',
  'payment.easyCard': '悠遊卡',
  'payment.prepaidWallet': '電子支付',
  'payment.bankAccount': '銀行帳戶',

  'category.allSubsTitle': '{major} — 所有子分類',
  'category.searchSubs': '搜尋子分類…',

  'tag.placeholder': '新增標籤…',

  'item.uncategorized': '其他',
  'item.inheritTag': '繼承分類',
  'item.namePlaceholder': '品項名稱',
  'item.notePlaceholder': '備註',

  'adj.discount': '折扣',
  'adj.fee': '手續費',
  'adj.refund': '退款',
  'adj.amountPlaceholder': '金額',
  'adj.percentPlaceholder': '折扣%',
  'adj.notePlaceholder': '備註（可不填）',

  'parentSearch.placeholder': '搜尋交易備註或品項…',
  'parentSearch.noResults90': '近90天無結果',
  'parentSearch.searchEarlier': '搜尋更早的交易',
  'parentSearch.noNote': '(無備註)',
};

export type Messages = typeof zh;
export type MessageKey = keyof Messages;
