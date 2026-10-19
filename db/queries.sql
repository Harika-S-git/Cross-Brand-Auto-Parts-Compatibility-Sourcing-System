-- =====================================================================
-- queries.sql : important queries / DML demonstrations (run manually in psql)
-- =====================================================================

-- Q1 JOIN + GROUP BY + HAVING + ORDER BY: brands offering >= 4 alternators, with price spread
SELECT p.brand, COUNT(*) AS alternators, MIN(get_unit_price(p.part_id,1)) AS cheapest, MAX(get_unit_price(p.part_id,1)) AS dearest
FROM parts p JOIN categories c ON c.category_id = p.category_id
WHERE c.name = 'Alternator'
GROUP BY p.brand HAVING COUNT(*) >= 4
ORDER BY alternators DESC, p.brand;

-- Q2 Cross-brand substitutes for one real part (M:N join through part_compatibility)
SELECT s.name AS supplier, p.brand, p.part_number, p.name, i.quantity AS stock, get_unit_price(p.part_id,1) AS price
FROM part_compatibility pc
JOIN vehicles v   ON v.vehicle_id = pc.vehicle_id
JOIN parts p      ON p.part_id = pc.part_id
JOIN suppliers s  ON s.supplier_id = p.supplier_id
JOIN inventory i  ON i.part_id = p.part_id
WHERE v.model = 'Civic' AND v.year = 2015 AND p.category_id = (SELECT category_id FROM categories WHERE name='Alternator')
  AND (p.specs->>'amperage')::int >= 90
ORDER BY price;

-- Q3 SUBQUERY: parts priced above the average for their category
SELECT p.brand, p.name, get_unit_price(p.part_id,1) AS price
FROM parts p
WHERE get_unit_price(p.part_id,1) > (SELECT AVG(get_unit_price(p2.part_id,1)) FROM parts p2 WHERE p2.category_id = p.category_id)
ORDER BY price DESC LIMIT 10;

-- Q4 Aggregate: revenue per supplier across multi-supplier orders
SELECT s.name, SUM(oi.quantity * oi.unit_price) AS revenue, COUNT(DISTINCT oi.order_id) AS orders
FROM order_items oi JOIN parts p ON p.part_id = oi.part_id JOIN suppliers s ON s.supplier_id = p.supplier_id
GROUP BY s.name ORDER BY revenue DESC;

-- Q5 Orders that draw from more than one supplier
SELECT o.order_id, COUNT(DISTINCT p.supplier_id) AS suppliers, SUM(oi.quantity*oi.unit_price) AS total
FROM orders o JOIN order_items oi ON oi.order_id=o.order_id JOIN parts p ON p.part_id=oi.part_id
GROUP BY o.order_id HAVING COUNT(DISTINCT p.supplier_id) > 1;

-- Q6 VIEWS
SELECT * FROM v_vehicle_compatible_parts WHERE model = 'Civic' AND year = 2015;
SELECT * FROM v_low_stock ORDER BY quantity;

-- Q7 Full-text search (keyword) -- needs the same words as the catalog text
SELECT brand, name, ts_rank(search_tsv, q) AS rank
FROM parts, websearch_to_tsquery('english', 'bosch alternator') q
WHERE search_tsv @@ q ORDER BY rank DESC;

-- Q8 Vector similarity: the 5 parts whose embedding is closest to part #1 (cosine distance <=>)
SELECT p2.part_id, p2.brand, p2.name, ROUND((1 - (p2.embedding <=> p1.embedding))::numeric, 3) AS similarity
FROM parts p1, parts p2
WHERE p1.part_id = 1 AND p2.part_id <> 1
ORDER BY p2.embedding <=> p1.embedding LIMIT 5;

-- Q9 Stored function (similarity + price + stock ranking) -- query vector taken from part #3 for the demo
SELECT brand, part_number, similarity, unit_price, stock, score
FROM rank_matches((SELECT embedding FROM parts WHERE part_id = 3),
                  (SELECT array_agg(vehicle_id) FROM vehicles WHERE model='Civic' AND year=2015), 90, 0.2, 5);

-- Q10 TRANSACTION: atomic multi-supplier order (all lines succeed or none)
BEGIN;
  INSERT INTO orders(buyer_id) VALUES (3) RETURNING order_id;                 -- say 100
  SELECT quantity FROM inventory WHERE part_id IN (2, 8) ORDER BY part_id FOR UPDATE;   -- lock stock rows
  UPDATE inventory SET quantity = quantity - 2 WHERE part_id = 2;             -- fires low-stock trigger if needed
  UPDATE inventory SET quantity = quantity - 1 WHERE part_id = 8;
  INSERT INTO order_items(order_id, part_id, quantity, unit_price)
    VALUES (currval('orders_order_id_seq'), 2, 2, get_unit_price(2,2)),
           (currval('orders_order_id_seq'), 8, 1, get_unit_price(8,1));
  UPDATE orders SET total_amount = (SELECT SUM(quantity*unit_price) FROM order_items WHERE order_id = currval('orders_order_id_seq'))
    WHERE order_id = currval('orders_order_id_seq');
ROLLBACK;   -- use COMMIT to keep it

-- Q11 DML: UPDATE / DELETE / INSERT with trigger effect
UPDATE inventory SET quantity = 1 WHERE part_id = 5;                 -- raises/keeps a low-stock alert
SELECT * FROM stock_alerts WHERE part_id = 5 AND NOT resolved;
UPDATE inventory SET quantity = 40 WHERE part_id = 5;                -- alert auto-resolves
DELETE FROM price_tiers WHERE part_id = 5 AND min_qty = 20;
INSERT INTO price_tiers(part_id, min_qty, unit_price) VALUES (5, 20, 4500);

-- Q12 Constraint demonstrations (each statement is expected to FAIL)
-- UPDATE inventory SET quantity = -1 WHERE part_id = 1;                     -- chk_qty_nonneg
-- INSERT INTO users(name,email,password_hash,role) VALUES ('x','bad','h','buyer');   -- chk_user_email
-- INSERT INTO order_items(order_id,part_id,quantity,unit_price) VALUES (1,99999,1,10);  -- FK violation

-- Q13 EXPLAIN: confirm the HNSW index is used for ANN search
-- EXPLAIN ANALYZE SELECT part_id FROM parts ORDER BY embedding <=> (SELECT embedding FROM parts WHERE part_id=1) LIMIT 10;
