-- ============================================
-- Fase 1 - Stock Movil QR (Base de datos)
-- Ejecutar en Supabase SQL Editor
-- ============================================
-- Este script es idempotente para bases existentes.
-- Luego de ejecutar este archivo, ejecutar:
--   1) supabase/functions.sql
-- para cargar los RPC nuevos.

BEGIN;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS stock_revision BIGINT NOT NULL DEFAULT 1;

UPDATE products
SET stock_revision = 1
WHERE stock_revision IS NULL
   OR stock_revision < 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_stock_revision_positive'
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_stock_revision_positive CHECK (stock_revision > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_stock_revision
ON products(stock_revision);

CREATE TABLE IF NOT EXISTS mobile_access_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,
  qr_token TEXT UNIQUE NOT NULL,
  issued_by UUID REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_access_codes_expires_at
ON mobile_access_codes(expires_at);

CREATE INDEX IF NOT EXISTS idx_mobile_access_codes_revoked_at
ON mobile_access_codes(revoked_at);

CREATE TABLE IF NOT EXISTS mobile_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  access_code_id UUID NOT NULL REFERENCES mobile_access_codes(id) ON DELETE CASCADE,
  operator_name TEXT,
  scope TEXT NOT NULL DEFAULT 'stock_only',
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'mobile_sessions_scope_check'
  ) THEN
    ALTER TABLE mobile_sessions
    ADD CONSTRAINT mobile_sessions_scope_check CHECK (scope IN ('stock_only'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mobile_sessions_expires_at
ON mobile_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_mobile_sessions_revoked_at
ON mobile_sessions(revoked_at);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id),
  performed_by_session_id UUID REFERENCES mobile_sessions(id),
  source TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT 'physical_count',
  stock_before INT NOT NULL,
  stock_counted INT NOT NULL,
  delta INT NOT NULL,
  stock_revision_before BIGINT NOT NULL,
  stock_revision_after BIGINT NOT NULL,
  is_flagged BOOLEAN NOT NULL DEFAULT false,
  flag_reason TEXT,
  review_status TEXT NOT NULL DEFAULT 'auto_applied',
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_adjustments_source_check'
  ) THEN
    ALTER TABLE stock_adjustments
    ADD CONSTRAINT stock_adjustments_source_check
    CHECK (source IN ('mobile_count', 'desktop_manual', 'audit_round'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_adjustments_review_status_check'
  ) THEN
    ALTER TABLE stock_adjustments
    ADD CONSTRAINT stock_adjustments_review_status_check
    CHECK (review_status IN ('auto_applied', 'reviewed_ok', 'reverted'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_product_id
ON stock_adjustments(product_id);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_created_at
ON stock_adjustments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_adjustments_review_status
ON stock_adjustments(review_status);

CREATE TABLE IF NOT EXISTS stock_audit_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id),
  started_by_session_id UUID NOT NULL REFERENCES mobile_sessions(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'open'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_audit_rounds_status_check'
  ) THEN
    ALTER TABLE stock_audit_rounds
    ADD CONSTRAINT stock_audit_rounds_status_check
    CHECK (status IN ('open', 'closed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_stock_audit_rounds_partner_id
ON stock_audit_rounds(partner_id);

CREATE INDEX IF NOT EXISTS idx_stock_audit_rounds_status
ON stock_audit_rounds(status);

CREATE TABLE IF NOT EXISTS stock_audit_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES stock_audit_rounds(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_audit_scans_round_id
ON stock_audit_scans(round_id);

CREATE INDEX IF NOT EXISTS idx_stock_audit_scans_product_id
ON stock_audit_scans(product_id);

ALTER TABLE mobile_access_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE mobile_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_audit_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_audit_scans ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mobile_access_codes'
      AND policyname = 'auth_all'
  ) THEN
    CREATE POLICY "auth_all"
    ON mobile_access_codes
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'mobile_sessions'
      AND policyname = 'auth_all'
  ) THEN
    CREATE POLICY "auth_all"
    ON mobile_sessions
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stock_adjustments'
      AND policyname = 'auth_all'
  ) THEN
    CREATE POLICY "auth_all"
    ON stock_adjustments
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stock_audit_rounds'
      AND policyname = 'auth_all'
  ) THEN
    CREATE POLICY "auth_all"
    ON stock_audit_rounds
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'stock_audit_scans'
      AND policyname = 'auth_all'
  ) THEN
    CREATE POLICY "auth_all"
    ON stock_audit_scans
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);
  END IF;
END $$;

COMMIT;
