-- ============================================
-- Migration 001: Create Clients Table
-- Stratton Candidate Engine
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- CLIENTS: شركات التوظيف (العملاء)
-- ============================================
CREATE TABLE IF NOT EXISTS clients (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) NOT NULL UNIQUE,
    ats_type        VARCHAR(50) NOT NULL CHECK (ats_type IN (
                        'bullhorn', 'avionte', 'ceipal', 
                        'recruit_crm', 'jobdiva', 'salesforce', 'custom'
                    )),
    status          VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN (
                        'active', 'inactive', 'onboarding', 'suspended'
                    )),
    config          JSONB NOT NULL DEFAULT '{}',
    contact_name    VARCHAR(255),
    contact_email   VARCHAR(255),
    contact_phone   VARCHAR(50),
    timezone        VARCHAR(50) NOT NULL DEFAULT 'America/New_York',
    max_daily_calls     INTEGER NOT NULL DEFAULT 500,
    max_daily_sms       INTEGER NOT NULL DEFAULT 1000,
    outreach_hours_start TIME NOT NULL DEFAULT '09:00:00',
    outreach_hours_end   TIME NOT NULL DEFAULT '18:00:00',
    outreach_days       INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}',
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookup
CREATE INDEX idx_clients_slug ON clients(slug);
CREATE INDEX idx_clients_status ON clients(status);
CREATE INDEX idx_clients_ats_type ON clients(ats_type);

-- ============================================
-- ATS_CONNECTIONS: اتصالات API مع أنظمة ATS
-- ============================================
CREATE TABLE IF NOT EXISTS ats_connections (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    platform            VARCHAR(50) NOT NULL,
    api_url             VARCHAR(500) NOT NULL,
    auth_type           VARCHAR(30) NOT NULL CHECK (auth_type IN (
                            'oauth2', 'api_key', 'basic', 'bearer'
                        )),
    credentials_encrypted BYTEA,
    oauth_access_token  TEXT,
    oauth_refresh_token TEXT,
    token_expires_at    TIMESTAMPTZ,
    field_mappings      JSONB NOT NULL DEFAULT '{}',
    sync_config         JSONB NOT NULL DEFAULT '{}',
    last_sync_at        TIMESTAMPTZ,
    sync_status         VARCHAR(20) DEFAULT 'pending' CHECK (sync_status IN (
                            'pending', 'syncing', 'success', 'error'
                        )),
    sync_error          TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ats_connections_client ON ats_connections(client_id);
CREATE INDEX idx_ats_connections_platform ON ats_connections(platform);

-- ============================================
-- RECRUITERS: المُوظِّفون لكل عميل
-- ============================================
CREATE TABLE IF NOT EXISTS recruiters (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    ats_recruiter_id VARCHAR(255),
    name            VARCHAR(255) NOT NULL,
    email           VARCHAR(255) NOT NULL,
    phone           VARCHAR(50),
    calendar_type   VARCHAR(20) CHECK (calendar_type IN ('google', 'microsoft', 'none')),
    calendar_id     VARCHAR(500),
    calendar_credentials_encrypted BYTEA,
    specialties     TEXT[] DEFAULT '{}',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    max_daily_interviews INTEGER DEFAULT 10,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recruiters_client ON recruiters(client_id);
CREATE INDEX idx_recruiters_email ON recruiters(email);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_ats_connections_updated_at BEFORE UPDATE ON ats_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_recruiters_updated_at BEFORE UPDATE ON recruiters
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
