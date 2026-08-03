-- Controlled, owner-reviewed Google Sheets synchronization.
-- This migration creates only review/audit infrastructure. It does not connect
-- credentials, read Google, or change live product/inventory data.

CREATE TABLE IF NOT EXISTS public.sheet_sync_sources (
    id BIGSERIAL PRIMARY KEY,
    source_key VARCHAR(100) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    spreadsheet_id VARCHAR(128) NOT NULL,
    sheet_name VARCHAR(255) NOT NULL,
    cell_range VARCHAR(64) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sheet_sync_mappings (
    id BIGSERIAL PRIMARY KEY,
    source_id BIGINT NOT NULL REFERENCES public.sheet_sync_sources(id) ON DELETE CASCADE,
    source_header VARCHAR(255) NOT NULL,
    destination_entity VARCHAR(100) NOT NULL,
    destination_field VARCHAR(100) NOT NULL,
    expected_type VARCHAR(50) NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    approval_mode VARCHAR(30) NOT NULL DEFAULT 'manual_review',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sheet_sync_mapping_definition UNIQUE (
        source_id, source_header, destination_entity, destination_field
    ),
    CONSTRAINT check_sheet_sync_mapping_approval
        CHECK (approval_mode = 'manual_review')
);

CREATE TABLE IF NOT EXISTS public.sheet_sync_runs (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(36) NOT NULL UNIQUE,
    trigger_type VARCHAR(30) NOT NULL DEFAULT 'manual',
    status VARCHAR(30) NOT NULL DEFAULT 'running',
    source_keys_json TEXT NOT NULL DEFAULT '[]',
    summary_json TEXT NOT NULL DEFAULT '{}',
    requested_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error_code VARCHAR(100),
    error_message TEXT,
    CONSTRAINT check_sheet_sync_run_status
        CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed'))
);

CREATE TABLE IF NOT EXISTS public.sheet_sync_snapshots (
    id BIGSERIAL PRIMARY KEY,
    run_id BIGINT NOT NULL REFERENCES public.sheet_sync_runs(id) ON DELETE CASCADE,
    source_id BIGINT NOT NULL REFERENCES public.sheet_sync_sources(id) ON DELETE RESTRICT,
    stable_identifier VARCHAR(255),
    row_number INTEGER NOT NULL CHECK (row_number > 0),
    raw_payload_json TEXT NOT NULL DEFAULT '{}',
    normalized_payload_json TEXT NOT NULL DEFAULT '{}',
    payload_hash VARCHAR(64) NOT NULL,
    validation_status VARCHAR(30) NOT NULL,
    validation_errors_json TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_sheet_sync_snapshot_row UNIQUE (run_id, source_id, row_number),
    CONSTRAINT check_sheet_sync_snapshot_validation_status
        CHECK (validation_status IN ('valid', 'invalid', 'duplicate', 'missing_identifier', 'blank'))
);

CREATE TABLE IF NOT EXISTS public.sheet_sync_changes (
    id BIGSERIAL PRIMARY KEY,
    public_id VARCHAR(36) NOT NULL UNIQUE,
    fingerprint VARCHAR(64) NOT NULL UNIQUE,
    run_id BIGINT NOT NULL REFERENCES public.sheet_sync_runs(id) ON DELETE RESTRICT,
    source_id BIGINT NOT NULL REFERENCES public.sheet_sync_sources(id) ON DELETE RESTRICT,
    snapshot_id BIGINT NOT NULL REFERENCES public.sheet_sync_snapshots(id) ON DELETE RESTRICT,
    stable_identifier VARCHAR(255) NOT NULL,
    source_row_number INTEGER NOT NULL CHECK (source_row_number > 0),
    source_header VARCHAR(255) NOT NULL,
    destination_entity VARCHAR(100) NOT NULL,
    destination_field VARCHAR(100) NOT NULL,
    raw_source_value_json TEXT NOT NULL DEFAULT 'null',
    previous_value_json TEXT NOT NULL DEFAULT 'null',
    proposed_value_json TEXT NOT NULL DEFAULT 'null',
    destination_version VARCHAR(64) NOT NULL,
    risk_level VARCHAR(20) NOT NULL,
    approval_mode VARCHAR(30) NOT NULL DEFAULT 'manual_review',
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at TIMESTAMPTZ,
    applied_at TIMESTAMPTZ,
    decided_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    applied_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    resolution_note TEXT,
    error_code VARCHAR(100),
    error_message TEXT,
    CONSTRAINT check_sheet_sync_change_status
        CHECK (status IN ('pending', 'accepted', 'rejected', 'ignored', 'applied', 'failed', 'conflict')),
    CONSTRAINT check_sheet_sync_change_approval
        CHECK (approval_mode = 'manual_review')
);

CREATE TABLE IF NOT EXISTS public.sheet_sync_change_events (
    id BIGSERIAL PRIMARY KEY,
    change_id BIGINT NOT NULL REFERENCES public.sheet_sync_changes(id) ON DELETE RESTRICT,
    event_type VARCHAR(30) NOT NULL,
    actor_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    event_payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT check_sheet_sync_change_event_type
        CHECK (event_type IN ('detected', 'accepted', 'rejected', 'ignored', 'applied', 'failed', 'conflict'))
);

-- SQLAlchemy's historical startup `create_all` may have created these tables
-- without server-side defaults. Normalize the existing schema before the
-- seed INSERTs so the reviewed migration remains idempotent in production.
ALTER TABLE public.sheet_sync_sources
    ALTER COLUMN is_active SET DEFAULT TRUE,
    ALTER COLUMN created_at SET DEFAULT NOW(),
    ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE public.sheet_sync_mappings
    ALTER COLUMN approval_mode SET DEFAULT 'manual_review',
    ALTER COLUMN is_active SET DEFAULT TRUE,
    ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE public.sheet_sync_runs
    ALTER COLUMN trigger_type SET DEFAULT 'manual',
    ALTER COLUMN status SET DEFAULT 'running',
    ALTER COLUMN source_keys_json SET DEFAULT '[]',
    ALTER COLUMN summary_json SET DEFAULT '{}',
    ALTER COLUMN started_at SET DEFAULT NOW();
ALTER TABLE public.sheet_sync_snapshots
    ALTER COLUMN raw_payload_json SET DEFAULT '{}',
    ALTER COLUMN normalized_payload_json SET DEFAULT '{}',
    ALTER COLUMN validation_errors_json SET DEFAULT '[]',
    ALTER COLUMN created_at SET DEFAULT NOW();
ALTER TABLE public.sheet_sync_changes
    ALTER COLUMN raw_source_value_json SET DEFAULT 'null',
    ALTER COLUMN previous_value_json SET DEFAULT 'null',
    ALTER COLUMN proposed_value_json SET DEFAULT 'null',
    ALTER COLUMN approval_mode SET DEFAULT 'manual_review',
    ALTER COLUMN status SET DEFAULT 'pending',
    ALTER COLUMN detected_at SET DEFAULT NOW();
ALTER TABLE public.sheet_sync_change_events
    ALTER COLUMN event_payload_json SET DEFAULT '{}',
    ALTER COLUMN created_at SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS ix_sheet_sync_runs_status_started
    ON public.sheet_sync_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_sheet_sync_snapshots_identifier
    ON public.sheet_sync_snapshots(source_id, stable_identifier);
CREATE INDEX IF NOT EXISTS ix_sheet_sync_changes_review_queue
    ON public.sheet_sync_changes(status, detected_at DESC);
CREATE INDEX IF NOT EXISTS ix_sheet_sync_changes_destination
    ON public.sheet_sync_changes(destination_entity, stable_identifier, destination_field);
CREATE INDEX IF NOT EXISTS ix_sheet_sync_change_events_history
    ON public.sheet_sync_change_events(change_id, created_at ASC);

INSERT INTO public.sheet_sync_sources (
    source_key, display_name, spreadsheet_id, sheet_name, cell_range, is_active
) VALUES
    ('partner_skus', 'Partner Inventory - SKUs', '1cwxsw5sm00eSyMvaCAeLyJ2RZ5prSGNtsCFpdBH1qi4', 'SKUs', 'A4:F200', TRUE),
    ('partner_rte_food_info', 'Partner Inventory - RTE Food Info', '1cwxsw5sm00eSyMvaCAeLyJ2RZ5prSGNtsCFpdBH1qi4', 'RTE Food Info', 'B5:H200', TRUE)
ON CONFLICT (source_key) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    spreadsheet_id = EXCLUDED.spreadsheet_id,
    sheet_name = EXCLUDED.sheet_name,
    cell_range = EXCLUDED.cell_range,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

INSERT INTO public.sheet_sync_mappings (
    source_id, source_header, destination_entity, destination_field,
    expected_type, risk_level, approval_mode, is_active
)
SELECT source.id, mapping.source_header, 'product', mapping.destination_field,
       mapping.expected_type, mapping.risk_level, 'manual_review', TRUE
FROM public.sheet_sync_sources AS source
JOIN (VALUES
    ('partner_skus', 'Product Name', 'product_name', 'string', 'low'),
    ('partner_skus', 'Size', 'size', 'string', 'high'),
    ('partner_skus', 'Category', 'category', 'string', 'high'),
    ('partner_skus', 'Pack QTY', 'pack_qty', 'non_negative_integer', 'medium'),
    ('partner_rte_food_info', 'Product Name', 'product_name', 'string', 'low'),
    ('partner_rte_food_info', 'H+H Price', 'retail_price', 'money', 'high'),
    ('partner_rte_food_info', 'Reseller''s Price', 'reseller_price', 'money', 'high')
) AS mapping(source_key, source_header, destination_field, expected_type, risk_level)
    ON mapping.source_key = source.source_key
ON CONFLICT (source_id, source_header, destination_entity, destination_field)
DO UPDATE SET
    expected_type = EXCLUDED.expected_type,
    risk_level = EXCLUDED.risk_level,
    approval_mode = 'manual_review',
    is_active = TRUE;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'sheet_sync_sources',
        'sheet_sync_mappings',
        'sheet_sync_runs',
        'sheet_sync_snapshots',
        'sheet_sync_changes',
        'sheet_sync_change_events'
    ]
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
        EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
        EXECUTE format('DROP POLICY IF EXISTS service_role_full_access ON public.%I', table_name);
        EXECUTE format(
            'CREATE POLICY service_role_full_access ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
            table_name
        );
    END LOOP;
END $$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
