-- =====================================================================
-- 03_alter_demo.sql : schema evolution (ALTER / DROP) applied after the base schema
-- =====================================================================
ALTER TABLE parts ADD COLUMN IF NOT EXISTS warranty_months INT NOT NULL DEFAULT 12;
ALTER TABLE parts DROP CONSTRAINT IF EXISTS chk_warranty;
ALTER TABLE parts ADD CONSTRAINT chk_warranty CHECK (warranty_months BETWEEN 0 AND 120);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;

-- a throw-away index is created and dropped to demonstrate DROP INDEX
CREATE INDEX IF NOT EXISTS idx_tmp_parts_brand ON parts (brand);
DROP INDEX IF EXISTS idx_tmp_parts_brand;
