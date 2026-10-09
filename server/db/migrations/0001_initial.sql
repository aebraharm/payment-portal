-- Initial schema for the payment portal.
-- Monetary amounts are NUMERIC(18,2) and always stored alongside an explicit currency.
-- Financial evidence (submissions, receipts, ledger, audit events) is never deleted by the application.

CREATE TABLE sequences (
  name text PRIMARY KEY,
  value bigint NOT NULL DEFAULT 0
);

CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('super_admin', 'finance_reviewer', 'viewer')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  password_hash text,
  must_change_password boolean NOT NULL DEFAULT false,
  password_changed_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_code text NOT NULL UNIQUE,
  full_name text NOT NULL,
  login_name text NOT NULL UNIQUE,
  email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  access_code_hash text,
  access_code_set_at timestamptz,
  created_by uuid REFERENCES admin_users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL CHECK (actor_type IN ('admin', 'client')),
  admin_id uuid REFERENCES admin_users (id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (
    (actor_type = 'admin' AND admin_id IS NOT NULL AND client_id IS NULL)
    OR (actor_type = 'client' AND client_id IS NOT NULL AND admin_id IS NULL)
  )
);
CREATE INDEX sessions_admin_idx ON sessions (admin_id);
CREATE INDEX sessions_client_idx ON sessions (client_id);

CREATE TABLE one_time_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('client_invitation', 'admin_invitation', 'admin_password_reset')),
  subject_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES admin_users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  invalidated_at timestamptz
);
CREATE INDEX one_time_tokens_subject_idx ON one_time_tokens (purpose, subject_id);

CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  hits integer NOT NULL
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  draft_value jsonb NOT NULL,
  published_value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES admin_users (id),
  published_at timestamptz,
  published_by uuid REFERENCES admin_users (id)
);

CREATE TABLE branding_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('logo', 'favicon')),
  content_type text NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  sha256 text NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES admin_users (id)
);

CREATE TABLE currencies (
  code char(3) PRIMARY KEY CHECK (code IN ('USD', 'CAD', 'EUR', 'GBP')),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES admin_users (id)
);
INSERT INTO currencies (code) VALUES ('USD'), ('CAD'), ('EUR'), ('GBP');

CREATE TABLE payment_methods (
  method text PRIMARY KEY CHECK (method IN ('bank_transfer', 'western_union', 'card')),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES admin_users (id),
  -- Card payments cannot be enabled until a processor integration exists.
  CHECK (method <> 'card' OR enabled = false)
);
INSERT INTO payment_methods (method) VALUES ('bank_transfer'), ('western_union'), ('card');

CREATE TABLE bank_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency char(3) NOT NULL REFERENCES currencies (code),
  transfer_type text NOT NULL,
  label text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES admin_users (id)
);
CREATE INDEX bank_profiles_currency_idx ON bank_profiles (currency, sort_order);

CREATE TABLE western_union_config (
  id smallint PRIMARY KEY CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES admin_users (id)
);
INSERT INTO western_union_config (id) VALUES (1);

CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  client_id uuid NOT NULL REFERENCES clients (id),
  description text NOT NULL,
  currency char(3) NOT NULL REFERENCES currencies (code),
  total_amount numeric(18, 2) NOT NULL CHECK (total_amount > 0),
  issue_date date NOT NULL,
  due_date date NOT NULL,
  partial_payments_allowed boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled')),
  cancel_reason text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES admin_users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES admin_users (id),
  CHECK (due_date >= issue_date)
);
CREATE INDEX invoices_client_idx ON invoices (client_id);
CREATE INDEX invoices_status_idx ON invoices (status, due_date);

CREATE TABLE invoice_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  description text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('charge', 'fee', 'discount')),
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  sort_order integer NOT NULL DEFAULT 0
);
CREATE INDEX invoice_line_items_invoice_idx ON invoice_line_items (invoice_id, sort_order);

CREATE TABLE payment_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE,
  client_id uuid NOT NULL REFERENCES clients (id),
  invoice_id uuid NOT NULL REFERENCES invoices (id),
  method text NOT NULL CHECK (method IN ('bank_transfer', 'western_union')),
  currency char(3) NOT NULL REFERENCES currencies (code),
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  bank_profile_id uuid REFERENCES bank_profiles (id),
  -- The exact instructions shown to the client when the reference was issued. Never recomputed.
  instructions_snapshot jsonb NOT NULL,
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'cancelled')),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, idempotency_key)
);
CREATE INDEX payment_references_invoice_idx ON payment_references (invoice_id);
CREATE INDEX payment_references_client_idx ON payment_references (client_id, created_at);

CREATE TABLE payment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_id uuid NOT NULL REFERENCES payment_references (id),
  invoice_id uuid NOT NULL REFERENCES invoices (id),
  client_id uuid NOT NULL REFERENCES clients (id),
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'under_review', 'info_requested', 'verified', 'rejected', 'superseded')),
  method text NOT NULL CHECK (method IN ('bank_transfer', 'western_union')),
  currency char(3) NOT NULL REFERENCES currencies (code),
  amount_sent numeric(18, 2) NOT NULL CHECK (amount_sent > 0),
  sent_on date NOT NULL,
  sender_name text NOT NULL DEFAULT '',
  sender_country text NOT NULL DEFAULT '',
  transfer_reference text NOT NULL DEFAULT '',
  transaction_id text NOT NULL DEFAULT '',
  client_note text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  verified_amount numeric(18, 2),
  verified_at timestamptz,
  verified_by uuid REFERENCES admin_users (id),
  rejection_reason text,
  info_request text,
  reviewed_by uuid REFERENCES admin_users (id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, idempotency_key),
  UNIQUE (reference_id, attempt_no)
);
CREATE INDEX payment_submissions_status_idx ON payment_submissions (status, created_at);
CREATE INDEX payment_submissions_invoice_idx ON payment_submissions (invoice_id, created_at);

CREATE TABLE submission_status_history (
  id bigserial PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES payment_submissions (id),
  from_status text,
  to_status text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('client', 'admin', 'system')),
  actor_id uuid,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX submission_status_history_idx ON submission_status_history (submission_id, id);

CREATE TABLE receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES payment_submissions (id),
  storage_driver text NOT NULL CHECK (storage_driver IN ('local', 's3')),
  storage_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  sha256 text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX receipts_submission_idx ON receipts (submission_id);

-- Append-only ledger. Verified payments and refunds are the only inputs to invoice payment totals.
CREATE TABLE payment_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices (id),
  submission_id uuid REFERENCES payment_submissions (id),
  kind text NOT NULL CHECK (kind IN ('verified_payment', 'refund')),
  amount numeric(18, 2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL REFERENCES currencies (code),
  reference_note text NOT NULL DEFAULT '',
  recorded_by uuid REFERENCES admin_users (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'verified_payment' AND submission_id IS NOT NULL) OR kind = 'refund')
);
CREATE UNIQUE INDEX payment_ledger_one_verification ON payment_ledger (submission_id) WHERE kind = 'verified_payment';
CREATE INDEX payment_ledger_invoice_idx ON payment_ledger (invoice_id);

CREATE TABLE admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('client', 'invoice', 'submission')),
  subject_id uuid NOT NULL,
  body text NOT NULL,
  author_id uuid REFERENCES admin_users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_notes_subject_idx ON admin_notes (subject_type, subject_id);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  recipient_type text NOT NULL CHECK (recipient_type IN ('client', 'admin')),
  client_id uuid REFERENCES clients (id),
  recipient_address text NOT NULL DEFAULT '',
  subject text NOT NULL,
  -- NULL for sensitive messages (links with one-time tokens). Those cannot be re-sent; re-issue instead.
  body text,
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'failed', 'not_configured', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  dedupe_key text UNIQUE,
  invoice_id uuid REFERENCES invoices (id),
  submission_id uuid REFERENCES payment_submissions (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_client_idx ON notifications (client_id, created_at);
CREATE INDEX notifications_status_idx ON notifications (status, created_at);

CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL CHECK (actor_type IN ('admin', 'client', 'system', 'anonymous')),
  actor_id uuid,
  action text NOT NULL,
  entity_type text,
  entity_id text,
  summary text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash text
);
CREATE INDEX audit_events_occurred_idx ON audit_events (occurred_at DESC);
CREATE INDEX audit_events_entity_idx ON audit_events (entity_type, entity_id);

CREATE FUNCTION audit_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only; updates and deletes are not permitted';
END;
$fn$;

CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();
