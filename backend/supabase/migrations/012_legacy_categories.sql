-- Legacy category curation migration.
-- Adds major-level rows missing from 011 seed, then all curated (major, subcategory) pairs
-- with count > 12 in the final dry-run. Low-frequency pairs are created at runtime by
-- migrate-legacy.ts auto-upsert (T012) with sort_order=9999.
-- All inserts are idempotent via ON CONFLICT DO NOTHING.

INSERT INTO categories (major, subcategory, sort_order) VALUES

  -- ── 其他 (major row missing from 011) ──────────────────────────────────────
  ('其他', NULL,              0),
  ('其他', '國外交易服務費',       10),  -- 233
  ('其他', '手續費',            20),  -- 229
  ('其他', '日用品',            30),  -- 227
  ('其他', '電信費',            40),  -- 181
  ('其他', '家用',             50),  -- 111
  ('其他', 'App',            60),  --  54
  ('其他', '3C周邊',           70),  --  51

  -- ── 衣 (major row missing from 011) ────────────────────────────────────────
  ('衣',   NULL,              0),
  ('衣',   '理髮',             10),  --  69
  ('衣',   '衣物',             20),  --  47
  ('衣',   '人身部品',           30),  --  18

  -- ── 食 (011 seed ends at sort_order 60) ────────────────────────────────────
  ('食',   '手搖飲料',           70),  -- 1520
  ('食',   'Uber Eats',       80),  --  806
  ('食',   '咖啡',             90),  --  363
  ('食',   '宵夜',            100),  --  210
  ('食',   '補給',            110),  --  143
  ('食',   '冰品',            120),  --  128

  -- ── 行 (011 seed ends at sort_order 50) ────────────────────────────────────
  ('行',   '火車',             60),  -- 105
  ('行',   '高鐵',             70),  --  71
  ('行',   '保修',             80),  --  46
  ('行',   '機車部品',           90),  --  21
  ('行',   'U-Bike',        100),  --  20
  ('行',   'Uber',          110),  --  19
  ('行',   '租車',            120),  --  17
  ('行',   '規費',            130),  --  13

  -- ── 醫 (011 seed ends at sort_order 20) ────────────────────────────────────
  ('醫',   '保險',             30),  -- 166
  ('醫',   '看診費',            40),  -- 112
  ('醫',   '醫療用品',           50),  --  78
  -- ('醫', '成藥') removed — 011 seed already has 藥品; parser now outputs 藥品
  ('醫',   '健保',             70),  --  42
  ('醫',   '復健',             80),  --  30

  -- ── 住 (011 seed ends at sort_order 20) ────────────────────────────────────
  ('住',   '電費',             30),  --  49
  ('住',   '水費',             40),  --  20
  ('住',   '住宿',             50),  --  14

  -- ── 樂 (011 seed ends at sort_order 20) ────────────────────────────────────
  ('樂',   'Netflix',         30),  --  78
  ('樂',   'Youtube Premium', 40),  --  77
  ('樂',   'FFXIV',           50),  --  23
  ('樂',   '電影',             60),  --  20
  ('樂',   'Steam',           70),  --  19
  ('樂',   '潛水',             80)   --  15

  -- 育: 文具=8, 書籍=9 均低於門檻且 書籍 已在 011 seed，略過

ON CONFLICT DO NOTHING;
