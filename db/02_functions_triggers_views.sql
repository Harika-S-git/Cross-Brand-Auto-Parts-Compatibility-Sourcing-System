-- =====================================================================
-- 02_functions_triggers_views.sql : stored functions, triggers, views
-- =====================================================================

-- Effective unit price of a part for a given order quantity (volume tiers)
CREATE OR REPLACE FUNCTION get_unit_price(p_part INT, p_qty INT)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
    SELECT unit_price FROM price_tiers
    WHERE part_id = p_part AND min_qty <= GREATEST(p_qty, 1)
    ORDER BY min_qty DESC LIMIT 1;
$$;

-- ---------------------------------------------------------------------
-- STORED FUNCTION: best-match ranking
--   1. ANN vector search (cosine) over part embeddings -> 50 candidates
--      optionally restricted to compatible vehicles / minimum amperage
--   2. Re-rank candidates by a weighted score:
--        score = w_sim*similarity + w_price*price_score + w_stock*stock_score
--      price_score : 1 = cheapest candidate, 0 = dearest
--      stock_score : min(stock,50)/50
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rank_matches(
    p_query    vector(384),
    p_vehicles INT[]   DEFAULT NULL,
    p_min_amp  INT     DEFAULT NULL,
    p_min_sim  NUMERIC DEFAULT 0.0,
    p_limit    INT     DEFAULT 10,
    w_sim      NUMERIC DEFAULT 0.70,
    w_price    NUMERIC DEFAULT 0.15,
    w_stock    NUMERIC DEFAULT 0.15)
RETURNS TABLE (
    part_id INT, supplier_id INT, supplier_name TEXT, lead_time_days INT,
    brand TEXT, part_number TEXT, name TEXT, description TEXT, category TEXT,
    specs JSONB, similarity NUMERIC, unit_price NUMERIC, stock INT, score NUMERIC)
LANGUAGE plpgsql STABLE AS $$
BEGIN
    RETURN QUERY
    WITH cand AS (
        SELECT p.part_id AS pid, (1 - (p.embedding <=> p_query))::numeric AS sim
        FROM parts p
        WHERE p.embedding IS NOT NULL
          AND (p_vehicles IS NULL OR EXISTS (
                 SELECT 1 FROM part_compatibility c
                 WHERE c.part_id = p.part_id AND c.vehicle_id = ANY (p_vehicles)))
          AND (p_min_amp IS NULL OR (p.specs->>'amperage')::int >= p_min_amp)
        ORDER BY p.embedding <=> p_query
        LIMIT 50
    ), priced AS (
        SELECT c.pid, c.sim, get_unit_price(c.pid, 1) AS price, i.quantity AS qty
        FROM cand c JOIN inventory i ON i.part_id = c.pid
        WHERE c.sim >= p_min_sim AND get_unit_price(c.pid, 1) IS NOT NULL
    ), scored AS (
        SELECT pr.*,
               COALESCE((MAX(pr.price) OVER () - pr.price)
                        / NULLIF(MAX(pr.price) OVER () - MIN(pr.price) OVER (), 0), 1) AS price_score,
               LEAST(pr.qty, 50) / 50.0 AS stock_score
        FROM priced pr
    )
    SELECT p.part_id, s.supplier_id, s.name::text, s.lead_time_days,
           p.brand::text, p.part_number::text, p.name::text, p.description, c.name::text,
           p.specs, ROUND(sc.sim, 4), sc.price, sc.qty,
           ROUND(w_sim * sc.sim + w_price * sc.price_score + w_stock * sc.stock_score, 4)
    FROM scored sc
    JOIN parts p      ON p.part_id = sc.pid
    JOIN suppliers s  ON s.supplier_id = p.supplier_id
    JOIN categories c ON c.category_id = p.category_id
    ORDER BY 14 DESC, 11 DESC
    LIMIT p_limit;
END $$;

-- ---------------------------------------------------------------------
-- TRIGGERS
-- ---------------------------------------------------------------------
-- (1) auto-flag low stock / auto-resolve when replenished
CREATE OR REPLACE FUNCTION fn_low_stock_alert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.quantity <= NEW.reorder_threshold THEN
        INSERT INTO stock_alerts (part_id, quantity_at_alert, message)
        VALUES (NEW.part_id, NEW.quantity,
                format('Low stock: %s unit(s) left, reorder threshold is %s', NEW.quantity, NEW.reorder_threshold))
        ON CONFLICT (part_id) WHERE resolved = FALSE DO NOTHING;
    ELSE
        UPDATE stock_alerts SET resolved = TRUE WHERE part_id = NEW.part_id AND resolved = FALSE;
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_low_stock ON inventory;
CREATE TRIGGER trg_low_stock
AFTER INSERT OR UPDATE OF quantity, reorder_threshold ON inventory
FOR EACH ROW EXECUTE FUNCTION fn_low_stock_alert();

-- (2) keep inventory.updated_at current
CREATE OR REPLACE FUNCTION fn_touch_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_touch_inventory ON inventory;
CREATE TRIGGER trg_touch_inventory BEFORE UPDATE ON inventory
FOR EACH ROW EXECUTE FUNCTION fn_touch_inventory();

-- ---------------------------------------------------------------------
-- VIEWS
-- ---------------------------------------------------------------------
-- compatible-parts summary per vehicle and category
CREATE OR REPLACE VIEW v_vehicle_compatible_parts AS
SELECT v.vehicle_id, v.make, v.model, v.year, v.engine,
       c.name                               AS category,
       COUNT(p.part_id)                     AS compatible_parts,
       COUNT(DISTINCT p.supplier_id)        AS suppliers,
       COUNT(DISTINCT p.brand)              AS brands,
       MIN(get_unit_price(p.part_id, 1))    AS lowest_price,
       SUM(i.quantity)                      AS total_stock
FROM vehicles v
JOIN part_compatibility pc ON pc.vehicle_id = v.vehicle_id
JOIN parts p               ON p.part_id = pc.part_id
JOIN categories c          ON c.category_id = p.category_id
JOIN inventory i           ON i.part_id = p.part_id
GROUP BY v.vehicle_id, v.make, v.model, v.year, v.engine, c.name;

-- parts at/below their reorder level
CREATE OR REPLACE VIEW v_low_stock AS
SELECT p.part_id, p.supplier_id, p.brand, p.part_number, p.name, i.quantity, i.reorder_threshold
FROM parts p JOIN inventory i ON i.part_id = p.part_id
WHERE i.quantity <= i.reorder_threshold;
