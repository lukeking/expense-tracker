CREATE TABLE categories (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  major        TEXT NOT NULL,
  subcategory  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_category UNIQUE NULLS NOT DISTINCT (major, subcategory)
);

CREATE INDEX idx_categories_major ON categories (major);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.categories TO service_role;

-- Seed: initial categories
INSERT INTO categories (major, subcategory, sort_order) VALUES
  ('食', NULL,   0),
  ('食', '早餐', 10),
  ('食', '午餐', 20),
  ('食', '晚餐', 30),
  ('食', '下午茶', 40),
  ('食', '零食', 50),
  ('食', '飲料', 60),
  ('住', NULL,   0),
  ('住', '租金', 10),
  ('住', '水電', 20),
  ('行', NULL,   0),
  ('行', '捷運', 10),
  ('行', '公車', 20),
  ('行', '計程車', 30),
  ('行', '油費', 40),
  ('行', '停車', 50),
  ('育', NULL,   0),
  ('育', '書籍', 10),
  ('育', '課程', 20),
  ('樂', NULL,   0),
  ('樂', '娛樂', 10),
  ('樂', '旅遊', 20),
  ('醫', NULL,   0),
  ('醫', '掛號', 10),
  ('醫', '藥品', 20);
