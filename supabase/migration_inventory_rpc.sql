-- ============================================
-- Inventory Counts RPC (lightweight, no row data)
-- Returns total, available, low, out counts 
-- with optional owner and search filters.
-- ============================================

CREATE OR REPLACE FUNCTION get_inventory_counts(
  p_owner_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  total_count BIGINT,
  available_count BIGINT,
  low_count BIGINT,
  out_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT AS total_count,
    COUNT(*) FILTER (WHERE p.stock > 0 AND p.stock > p.min_stock)::BIGINT AS available_count,
    COUNT(*) FILTER (WHERE p.stock > 0 AND p.stock <= p.min_stock)::BIGINT AS low_count,
    COUNT(*) FILTER (WHERE p.stock <= 0)::BIGINT AS out_count
  FROM products p
  WHERE p.is_active = true
    AND (p_owner_id IS NULL OR p.owner_id = p_owner_id)
    AND (
      p_search IS NULL 
      OR p_search = '' 
      OR p.name ILIKE '%' || p_search || '%'
      OR p.barcode ILIKE '%' || p_search || '%'
      OR p.sku ILIKE '%' || p_search || '%'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;


-- ============================================
-- Paginated Inventory Query RPC
-- Returns products with owner data, supports
-- all filters including stock column comparison.
-- ============================================

CREATE OR REPLACE FUNCTION get_inventory_page(
  p_owner_id UUID DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_stock_filter TEXT DEFAULT 'all',
  p_offset INT DEFAULT 0,
  p_limit INT DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  barcode TEXT,
  sku TEXT,
  name TEXT,
  description TEXT,
  category TEXT,
  owner_id UUID,
  purchase_price NUMERIC(10,2),
  sale_price NUMERIC(10,2),
  stock INT,
  min_stock INT,
  image_url TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  owner_uuid UUID,
  owner_name TEXT,
  owner_display_name TEXT,
  owner_color_hex TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.barcode,
    p.sku,
    p.name,
    p.description,
    p.category,
    p.owner_id,
    p.purchase_price,
    p.sale_price,
    p.stock,
    p.min_stock,
    p.image_url,
    p.is_active,
    p.created_at,
    p.updated_at,
    pa.id AS owner_uuid,
    pa.name::TEXT AS owner_name,
    pa.display_name AS owner_display_name,
    pa.color_hex AS owner_color_hex
  FROM products p
  JOIN partners pa ON pa.id = p.owner_id
  WHERE p.is_active = true
    AND (p_owner_id IS NULL OR p.owner_id = p_owner_id)
    AND (
      p_search IS NULL 
      OR p_search = '' 
      OR p.name ILIKE '%' || p_search || '%'
      OR p.barcode ILIKE '%' || p_search || '%'
      OR p.sku ILIKE '%' || p_search || '%'
    )
    AND (
      p_stock_filter = 'all'
      OR (p_stock_filter = 'out' AND p.stock <= 0)
      OR (p_stock_filter = 'low' AND p.stock > 0 AND p.stock <= p.min_stock)
      OR (p_stock_filter = 'ok' AND p.stock > 0 AND p.stock > p.min_stock)
    )
  ORDER BY p.name
  OFFSET p_offset
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;
