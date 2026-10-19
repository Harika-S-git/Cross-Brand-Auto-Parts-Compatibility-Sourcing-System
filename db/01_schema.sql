-- =====================================================================
-- Cross-Brand Auto Parts Compatibility & Sourcing System
-- 01_schema.sql : DDL  (PostgreSQL 14+ with pgvector)
-- Idempotent: safe to re-run (drops and recreates everything).
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS vector;

DROP VIEW  IF EXISTS v_vehicle_compatible_parts, v_low_stock CASCADE;
DROP TABLE IF EXISTS stock_alerts, order_items, orders, price_tiers, inventory,
                     part_compatibility, parts, vehicles, categories, users, suppliers CASCADE;

-- ---------- Core entities ----------
CREATE TABLE suppliers (
    supplier_id    SERIAL PRIMARY KEY,
    name           VARCHAR(100) NOT NULL UNIQUE,
    contact_email  VARCHAR(120) NOT NULL
                   CONSTRAINT chk_supplier_email CHECK (contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    city           VARCHAR(60),
    lead_time_days INT NOT NULL DEFAULT 2
                   CONSTRAINT chk_lead_time CHECK (lead_time_days BETWEEN 0 AND 60)
);

CREATE TABLE users (
    user_id       SERIAL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(120) NOT NULL UNIQUE
                  CONSTRAINT chk_user_email CHECK (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    password_hash TEXT NOT NULL,                       -- bcrypt hash, never plain text
    role          VARCHAR(10) NOT NULL
                  CONSTRAINT chk_user_role CHECK (role IN ('staff', 'buyer')),
    supplier_id   INT REFERENCES suppliers(supplier_id) ON DELETE RESTRICT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- staff must belong to a supplier, buyers must not
    CONSTRAINT chk_role_supplier CHECK (
        (role = 'staff' AND supplier_id IS NOT NULL) OR (role = 'buyer' AND supplier_id IS NULL))
);

CREATE TABLE categories (
    category_id SERIAL PRIMARY KEY,
    name        VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE vehicles (
    vehicle_id SERIAL PRIMARY KEY,
    make       VARCHAR(40) NOT NULL,
    model      VARCHAR(40) NOT NULL,
    year       INT NOT NULL CONSTRAINT chk_vehicle_year CHECK (year BETWEEN 1980 AND 2035),
    engine     VARCHAR(30) NOT NULL,
    CONSTRAINT uq_vehicle UNIQUE (make, model, year, engine)
);

CREATE TABLE parts (
    part_id     SERIAL PRIMARY KEY,
    supplier_id INT NOT NULL REFERENCES suppliers(supplier_id) ON DELETE RESTRICT,
    category_id INT NOT NULL REFERENCES categories(category_id) ON DELETE RESTRICT,
    brand       VARCHAR(60)  NOT NULL,
    part_number VARCHAR(60)  NOT NULL,
    name        VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    specs       JSONB NOT NULL DEFAULT '{}'::jsonb,    -- e.g. {"amperage": 90}
    embedding   vector(384),                           -- semantic embedding (all-MiniLM-L6-v2)
    -- generated column used for classic full-text (keyword) search
    search_tsv  tsvector GENERATED ALWAYS AS (
                  to_tsvector('english', coalesce(brand,'') || ' ' || name || ' ' || description)) STORED,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_supplier_partno UNIQUE (supplier_id, part_number)
);

-- M:N  parts <-> vehicles
CREATE TABLE part_compatibility (
    part_id       INT NOT NULL REFERENCES parts(part_id)       ON DELETE CASCADE,
    vehicle_id    INT NOT NULL REFERENCES vehicles(vehicle_id) ON DELETE CASCADE,
    fitment_notes TEXT,
    PRIMARY KEY (part_id, vehicle_id)
);

-- 1:1 stock record per part
CREATE TABLE inventory (
    part_id           INT PRIMARY KEY REFERENCES parts(part_id) ON DELETE CASCADE,
    quantity          INT NOT NULL DEFAULT 0 CONSTRAINT chk_qty_nonneg CHECK (quantity >= 0),
    reorder_threshold INT NOT NULL DEFAULT 5 CONSTRAINT chk_threshold_nonneg CHECK (reorder_threshold >= 0),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- volume pricing: unit price applies from min_qty upward
CREATE TABLE price_tiers (
    tier_id    SERIAL PRIMARY KEY,
    part_id    INT NOT NULL REFERENCES parts(part_id) ON DELETE CASCADE,
    min_qty    INT NOT NULL CONSTRAINT chk_tier_minqty CHECK (min_qty >= 1),
    unit_price NUMERIC(10,2) NOT NULL CONSTRAINT chk_tier_price CHECK (unit_price > 0),
    CONSTRAINT uq_tier UNIQUE (part_id, min_qty)
);

CREATE TABLE orders (
    order_id     SERIAL PRIMARY KEY,
    buyer_id     INT NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    status       VARCHAR(12) NOT NULL DEFAULT 'placed'
                 CONSTRAINT chk_order_status CHECK (status IN ('placed','shipped','delivered','cancelled')),
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CONSTRAINT chk_order_total CHECK (total_amount >= 0),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- an order may draw parts from several suppliers (part -> supplier)
CREATE TABLE order_items (
    order_item_id SERIAL PRIMARY KEY,
    order_id      INT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    part_id       INT NOT NULL REFERENCES parts(part_id)   ON DELETE RESTRICT,
    quantity      INT NOT NULL CONSTRAINT chk_item_qty CHECK (quantity > 0),
    unit_price    NUMERIC(10,2) NOT NULL CONSTRAINT chk_item_price CHECK (unit_price > 0),
    CONSTRAINT uq_order_part UNIQUE (order_id, part_id)
);

CREATE TABLE stock_alerts (
    alert_id          SERIAL PRIMARY KEY,
    part_id           INT NOT NULL REFERENCES parts(part_id) ON DELETE CASCADE,
    quantity_at_alert INT NOT NULL,
    message           TEXT NOT NULL,
    resolved          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Indexes ----------
CREATE INDEX idx_parts_embedding ON parts USING hnsw (embedding vector_cosine_ops);   -- ANN vector search
CREATE INDEX idx_parts_tsv       ON parts USING gin (search_tsv);                     -- full-text search
CREATE INDEX idx_parts_specs     ON parts USING gin (specs jsonb_path_ops);           -- JSONB spec filter
CREATE INDEX idx_parts_supplier  ON parts (supplier_id);
CREATE INDEX idx_parts_category  ON parts (category_id);
CREATE INDEX idx_compat_vehicle  ON part_compatibility (vehicle_id);
CREATE INDEX idx_orders_buyer    ON orders (buyer_id);
CREATE INDEX idx_items_part      ON order_items (part_id);
-- at most one OPEN alert per part (partial unique index)
CREATE UNIQUE INDEX uq_open_alert ON stock_alerts (part_id) WHERE resolved = FALSE;
