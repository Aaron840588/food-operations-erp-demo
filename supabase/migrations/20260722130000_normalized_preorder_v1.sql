-- Normalized customer preorder v1.
--
-- Public catalog/submission traffic is mediated by FastAPI and an opaque token;
-- the Supabase Data API has no anon/authenticated access to these tables. V1
-- intentionally makes no stock reservation. Event allocation is deducted only
-- by the existing idempotent Market Event POS sale during fulfillment.

CREATE TABLE IF NOT EXISTS public.preorder_forms (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    token_hint VARCHAR(12) NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    event_id BIGINT REFERENCES public.market_events(id) ON DELETE RESTRICT,
    fulfillment_methods_json TEXT NOT NULL DEFAULT '["Pickup","Delivery"]',
    payment_preferences_json TEXT NOT NULL DEFAULT '[]',
    extension_json TEXT NOT NULL DEFAULT '{}',
    created_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    updated_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT check_preorder_form_token_hash CHECK (length(token_hash) = 64),
    CONSTRAINT check_preorder_form_name CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS public.preorders (
    id BIGSERIAL PRIMARY KEY,
    public_reference VARCHAR(24) NOT NULL UNIQUE,
    form_id BIGINT NOT NULL REFERENCES public.preorder_forms(id) ON DELETE RESTRICT,
    event_id BIGINT REFERENCES public.market_events(id) ON DELETE RESTRICT,
    submission_reference VARCHAR(64) NOT NULL,
    submission_fingerprint VARCHAR(64) NOT NULL,
    fulfillment_client_reference VARCHAR(64) NOT NULL UNIQUE,
    customer_name VARCHAR(120) NOT NULL,
    contact_email VARCHAR(254),
    contact_phone VARCHAR(50),
    requested_fulfillment_date DATE NOT NULL,
    requested_fulfillment_time TIME WITHOUT TIME ZONE NOT NULL,
    fulfillment_method VARCHAR(20) NOT NULL,
    delivery_address TEXT,
    notes TEXT,
    payment_preference VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'Pending',
    payment_status VARCHAR(20) NOT NULL DEFAULT 'Unpaid',
    total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    fulfillment_payment_status_intent VARCHAR(20),
    extension_json TEXT NOT NULL DEFAULT '{}',
    fulfillment_sale_id BIGINT UNIQUE REFERENCES public.market_event_sales(id) ON DELETE RESTRICT,
    updated_by_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fulfilled_at TIMESTAMPTZ,
    CONSTRAINT uq_preorder_form_submission_reference UNIQUE (form_id, submission_reference),
    CONSTRAINT check_preorder_status CHECK (
        status IN ('Pending', 'Confirmed', 'Preparing', 'Ready', 'Fulfilled', 'Cancelled', 'No-show')
    ),
    CONSTRAINT check_preorder_payment_status CHECK (
        payment_status IN ('Unpaid', 'Partial', 'Paid', 'Receivable', 'Refunded')
    ),
    CONSTRAINT check_preorder_fulfillment_method CHECK (
        fulfillment_method IN ('Pickup', 'Delivery')
    ),
    CONSTRAINT check_preorder_total_non_negative CHECK (total_amount >= 0.00),
    CONSTRAINT check_preorder_submission_fingerprint CHECK (length(submission_fingerprint) = 64),
    CONSTRAINT check_preorder_public_reference CHECK (length(public_reference) >= 12),
    CONSTRAINT check_preorder_contact_present CHECK (
        NULLIF(trim(contact_email), '') IS NOT NULL
        OR NULLIF(trim(contact_phone), '') IS NOT NULL
    ),
    CONSTRAINT check_preorder_delivery_address CHECK (
        fulfillment_method = 'Pickup'
        OR NULLIF(trim(delivery_address), '') IS NOT NULL
    ),
    CONSTRAINT check_preorder_fulfillment_intent CHECK (
        fulfillment_payment_status_intent IS NULL
        OR fulfillment_payment_status_intent IN ('Paid', 'Receivable')
    ),
    CONSTRAINT check_preorder_fulfillment_link CHECK (
        (
            status = 'Fulfilled'
            AND fulfillment_sale_id IS NOT NULL
            AND fulfilled_at IS NOT NULL
        )
        OR (
            status <> 'Fulfilled'
            AND fulfillment_sale_id IS NULL
            AND fulfilled_at IS NULL
        )
    )
);

CREATE TABLE IF NOT EXISTS public.preorder_items (
    id BIGSERIAL PRIMARY KEY,
    preorder_id BIGINT NOT NULL REFERENCES public.preorders(id) ON DELETE RESTRICT,
    sku VARCHAR(100) NOT NULL REFERENCES public.product_skus(sku) ON DELETE RESTRICT,
    product_name_snapshot VARCHAR(255) NOT NULL,
    size_snapshot VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price_snapshot NUMERIC(12, 2) NOT NULL,
    line_total_snapshot NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_preorder_item_sku UNIQUE (preorder_id, sku),
    CONSTRAINT check_preorder_item_quantity_positive CHECK (quantity > 0),
    CONSTRAINT check_preorder_item_unit_price_non_negative CHECK (unit_price_snapshot >= 0.00),
    CONSTRAINT check_preorder_item_line_total_non_negative CHECK (line_total_snapshot >= 0.00)
);

CREATE TABLE IF NOT EXISTS public.preorder_status_history (
    id BIGSERIAL PRIMARY KEY,
    preorder_id BIGINT NOT NULL REFERENCES public.preorders(id) ON DELETE RESTRICT,
    sequence_number INTEGER NOT NULL,
    action VARCHAR(50) NOT NULL,
    source VARCHAR(20) NOT NULL,
    from_status VARCHAR(20),
    to_status VARCHAR(20) NOT NULL,
    from_payment_status VARCHAR(20),
    to_payment_status VARCHAR(20) NOT NULL,
    actor_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    actor_username_snapshot VARCHAR(100),
    note TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_preorder_status_history_sequence UNIQUE (preorder_id, sequence_number),
    CONSTRAINT check_preorder_history_to_status CHECK (
        to_status IN ('Pending', 'Confirmed', 'Preparing', 'Ready', 'Fulfilled', 'Cancelled', 'No-show')
    ),
    CONSTRAINT check_preorder_history_to_payment_status CHECK (
        to_payment_status IN ('Unpaid', 'Partial', 'Paid', 'Receivable', 'Refunded')
    ),
    CONSTRAINT check_preorder_history_source CHECK (source IN ('public', 'internal', 'system')),
    CONSTRAINT check_preorder_history_internal_actor CHECK (
        source <> 'internal' OR actor_username_snapshot IS NOT NULL
    )
);

CREATE TABLE IF NOT EXISTS public.preorder_audit_events (
    id BIGSERIAL PRIMARY KEY,
    form_id BIGINT REFERENCES public.preorder_forms(id) ON DELETE RESTRICT,
    preorder_id BIGINT REFERENCES public.preorders(id) ON DELETE RESTRICT,
    action VARCHAR(50) NOT NULL,
    actor_user_id BIGINT REFERENCES public.users(id) ON DELETE SET NULL,
    actor_username_snapshot VARCHAR(100) NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT check_preorder_audit_single_subject CHECK (
        (form_id IS NOT NULL AND preorder_id IS NULL)
        OR (form_id IS NULL AND preorder_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS ix_preorder_forms_event
    ON public.preorder_forms(event_id);
CREATE INDEX IF NOT EXISTS ix_preorder_forms_created_by
    ON public.preorder_forms(created_by_user_id);
CREATE INDEX IF NOT EXISTS ix_preorder_forms_updated_by
    ON public.preorder_forms(updated_by_user_id);
CREATE INDEX IF NOT EXISTS ix_preorders_owner_queue
    ON public.preorders(status, requested_fulfillment_date, requested_fulfillment_time, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_preorders_staff_queue
    ON public.preorders(event_id, status, requested_fulfillment_date, requested_fulfillment_time, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_preorders_payment_created
    ON public.preorders(payment_status, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_preorders_form_created
    ON public.preorders(form_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_preorders_updated_by
    ON public.preorders(updated_by_user_id);
CREATE INDEX IF NOT EXISTS ix_preorder_items_sku
    ON public.preorder_items(sku);
CREATE INDEX IF NOT EXISTS ix_preorder_status_history_actor
    ON public.preorder_status_history(actor_user_id);
CREATE INDEX IF NOT EXISTS ix_preorder_status_history_order
    ON public.preorder_status_history(preorder_id, sequence_number);
CREATE INDEX IF NOT EXISTS ix_preorder_audit_form_history
    ON public.preorder_audit_events(form_id, created_at);
CREATE INDEX IF NOT EXISTS ix_preorder_audit_preorder_history
    ON public.preorder_audit_events(preorder_id, created_at);
CREATE INDEX IF NOT EXISTS ix_preorder_audit_actor
    ON public.preorder_audit_events(actor_user_id, created_at DESC);

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'preorder_forms',
        'preorders',
        'preorder_items',
        'preorder_status_history',
        'preorder_audit_events'
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

REVOKE ALL ON SEQUENCE public.preorder_forms_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.preorders_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.preorder_items_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.preorder_status_history_id_seq FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.preorder_audit_events_id_seq FROM anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.preorder_forms_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.preorders_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.preorder_items_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.preorder_status_history_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.preorder_audit_events_id_seq TO service_role;
