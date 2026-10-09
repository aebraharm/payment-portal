-- ============================================================================
-- Initial schema — immigration agency payment portal
-- Portable SQL (SQLite in dev; see docs/DEPLOYMENT.md for PostgreSQL notes).
-- Money is always stored as integer minor units (cents) plus a currency code.
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('superadmin', 'admin', 'reviewer')),
  full_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  access_code_hash TEXT NOT NULL,
  access_code_hint TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(full_name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin', 'client')),
  actor_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_actor ON sessions(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by INTEGER
);

CREATE TABLE IF NOT EXISTS currencies (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_methods (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_instructions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  currency TEXT NOT NULL REFERENCES currencies(code),
  profile_name TEXT NOT NULL,
  transfer_types TEXT NOT NULL DEFAULT '[]',
  fields TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bank_instructions_currency ON bank_instructions(currency, enabled);

CREATE TABLE IF NOT EXISTS western_union_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  display_name TEXT NOT NULL DEFAULT 'Western Union',
  currencies TEXT NOT NULL DEFAULT '[]',
  countries TEXT NOT NULL DEFAULT '[]',
  recipient_name TEXT,
  recipient_location TEXT,
  country_of_receipt TEXT,
  instructions TEXT,
  required_sender_info TEXT NOT NULL DEFAULT '[]',
  required_recipient_info TEXT NOT NULL DEFAULT '[]',
  mtcn_required INTEGER NOT NULL DEFAULT 1,
  receipt_required INTEGER NOT NULL DEFAULT 1,
  additional_notes TEXT,
  client_instructions TEXT,
  help_text TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_ref TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  currency TEXT NOT NULL REFERENCES currencies(code),
  issue_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN (
    'draft', 'unpaid', 'awaiting_payment', 'confirmation_submitted',
    'under_review', 'paid', 'partially_paid', 'rejected', 'refunded', 'cancelled'
  )),
  allow_partial INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by INTEGER REFERENCES admins(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  cancel_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_amount_cents INTEGER NOT NULL CHECK (unit_amount_cents >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payment_references (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_code TEXT NOT NULL UNIQUE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  method TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  instructions_snapshot TEXT NOT NULL,
  bank_profile_id INTEGER,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN (
    'issued', 'confirmation_submitted', 'under_review', 'verified', 'rejected', 'info_requested'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_references_client ON payment_references(client_id);
CREATE INDEX IF NOT EXISTS idx_payment_references_invoice ON payment_references(invoice_id);

CREATE TABLE IF NOT EXISTS payment_confirmations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_reference_id INTEGER NOT NULL REFERENCES payment_references(id),
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  method TEXT NOT NULL,
  sent_date TEXT NOT NULL,
  amount_sent_cents INTEGER NOT NULL CHECK (amount_sent_cents > 0),
  currency TEXT NOT NULL,
  sender_name TEXT,
  transfer_reference TEXT,
  transaction_id TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN (
    'submitted', 'under_review', 'verified', 'rejected', 'info_requested'
  )),
  reviewer_id INTEGER REFERENCES admins(id),
  reviewed_at TEXT,
  rejection_reason TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
-- One *active* confirmation per payment reference: after a rejection or an
-- info request the client may submit a corrected confirmation, and duplicate
-- concurrent submissions are still impossible.
CREATE UNIQUE INDEX IF NOT EXISTS idx_confirmations_one_active
  ON payment_confirmations(payment_reference_id)
  WHERE status NOT IN ('rejected', 'info_requested');
CREATE UNIQUE INDEX IF NOT EXISTS idx_confirmations_idempotency
  ON payment_confirmations(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_confirmations_client ON payment_confirmations(client_id, status);
CREATE INDEX IF NOT EXISTS idx_confirmations_status ON payment_confirmations(status);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  confirmation_id INTEGER NOT NULL REFERENCES payment_confirmations(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  uploaded_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_receipts_confirmation ON receipts(confirmation_id);

CREATE TABLE IF NOT EXISTS confirmation_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  confirmation_id INTEGER NOT NULL REFERENCES payment_confirmations(id),
  status TEXT NOT NULL,
  note TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin', 'client', 'system')),
  actor_id INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER REFERENCES clients(id),
  confirmation_id INTEGER REFERENCES payment_confirmations(id),
  note TEXT NOT NULL,
  admin_id INTEGER NOT NULL REFERENCES admins(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  recipient TEXT,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped_not_configured')),
  channel TEXT NOT NULL DEFAULT 'email',
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('admin', 'client', 'system')),
  actor_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity, entity_id);

CREATE TABLE IF NOT EXISTS sequences (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
