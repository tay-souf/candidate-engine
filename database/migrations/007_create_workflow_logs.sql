-- ============================================
-- Migration 007: Create Workflow Logs & RLS
-- Stratton Candidate Engine
-- ============================================

-- ============================================
-- WORKFLOW_LOGS: سجلات سير العمل
-- ============================================
CREATE TABLE IF NOT EXISTS workflow_logs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    campaign_id         UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    
    -- Workflow Info
    workflow_name       VARCHAR(255) NOT NULL,
    workflow_type       VARCHAR(50) NOT NULL CHECK (workflow_type IN (
                            'sync', 'outreach', 'qualification', 'scheduling',
                            'writeback', 'follow_up', 'opt_out', 'webhook',
                            'retry', 'maintenance', 'error_recovery'
                        )),
    n8n_execution_id    VARCHAR(255),
    
    -- Execution Details
    status              VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN (
                            'running', 'success', 'error', 'warning',
                            'cancelled', 'timeout', 'skipped'
                        )),
    
    -- Data
    input_data          JSONB DEFAULT '{}',
    output_data         JSONB DEFAULT '{}',
    
    -- Error Details
    error_type          VARCHAR(100),
    error_message       TEXT,
    error_stack         TEXT,
    
    -- Performance
    duration_ms         INTEGER,
    items_processed     INTEGER DEFAULT 0,
    items_succeeded     INTEGER DEFAULT 0,
    items_failed        INTEGER DEFAULT 0,
    
    -- Context
    triggered_by        VARCHAR(100),
    parent_log_id       UUID REFERENCES workflow_logs(id),
    
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partitioned index for time-range queries (logs can grow large)
CREATE INDEX idx_workflow_logs_client ON workflow_logs(client_id);
CREATE INDEX idx_workflow_logs_campaign ON workflow_logs(campaign_id);
CREATE INDEX idx_workflow_logs_status ON workflow_logs(status);
CREATE INDEX idx_workflow_logs_type ON workflow_logs(workflow_type);
CREATE INDEX idx_workflow_logs_date ON workflow_logs(started_at DESC);
CREATE INDEX idx_workflow_logs_n8n ON workflow_logs(n8n_execution_id) WHERE n8n_execution_id IS NOT NULL;
CREATE INDEX idx_workflow_logs_errors ON workflow_logs(started_at DESC) WHERE status = 'error';

-- ============================================
-- API_RATE_LIMITS: تتبع حدود API
-- ============================================
CREATE TABLE IF NOT EXISTS api_rate_limits (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    
    api_name        VARCHAR(100) NOT NULL,
    endpoint        VARCHAR(500),
    
    -- Rate Limit Config
    max_requests    INTEGER NOT NULL,
    window_seconds  INTEGER NOT NULL,
    
    -- Current State
    current_count   INTEGER NOT NULL DEFAULT 0,
    window_start    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_request_at TIMESTAMPTZ,
    
    -- Retry After
    retry_after     TIMESTAMPTZ,
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(client_id, api_name, endpoint)
);

CREATE INDEX idx_rate_limits_client ON api_rate_limits(client_id);
CREATE INDEX idx_rate_limits_api ON api_rate_limits(api_name);

-- ============================================
-- SYSTEM_CONFIG: إعدادات النظام
-- ============================================
CREATE TABLE IF NOT EXISTS system_config (
    key             VARCHAR(255) PRIMARY KEY,
    value           JSONB NOT NULL,
    description     TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default system config
INSERT INTO system_config (key, value, description) VALUES
('max_concurrent_calls', '50', 'Maximum concurrent Retell AI calls'),
('max_sms_per_second', '10', 'Maximum SMS messages per second via Twilio'),
('default_cooldown_hours', '24', 'Default hours between contact attempts'),
('opt_out_keywords', '["stop", "unsubscribe", "opt out", "optout", "cancel", "remove", "quit", "end"]', 'Keywords that trigger automatic opt-out'),
('retry_config', '{"maxRetries": 3, "initialDelay": 1000, "maxDelay": 30000, "backoffMultiplier": 2}', 'Default retry configuration'),
('maintenance_mode', 'false', 'System maintenance mode flag')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- ROW LEVEL SECURITY: فصل بيانات العملاء
-- ============================================

-- Enable RLS on all tenant-specific tables
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE opt_outs ENABLE ROW LEVEL SECURITY;
ALTER TABLE qualifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ats_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE recruiters ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_candidates ENABLE ROW LEVEL SECURITY;

-- Create policies (using app.current_client_id setting)
-- The API sets this via SET LOCAL before each request

CREATE POLICY client_isolation_candidates ON candidates
    USING (client_id = NULLIF(current_setting('app.current_client_id', true), '')::UUID);

CREATE POLICY client_isolation_campaigns ON campaigns
    USING (client_id = NULLIF(current_setting('app.current_client_id', true), '')::UUID);

CREATE POLICY client_isolation_job_orders ON job_orders
    USING (client_id = NULLIF(current_setting('app.current_client_id', true), '')::UUID);

CREATE POLICY client_isolation_contact_attempts ON contact_attempts
    USING (client_id = NULLIF(current_setting('app.current_client_id', true), '')::UUID);

CREATE POLICY client_isolation_opt_outs ON opt_outs
    USING (client_id = NULLIF(current_setting('app.current_client_id', true), '')::UUID);

CREATE POLICY client_isolation_qualifications ON qualifications
    USING (client_id = NULLIF(current_setting('app.current_client_id', true), '')::UUID);

CREATE POLICY client_isolation_appointments ON appointments
    USING (client_id = NULLIF(current_setting('app.current_client_id', true), '')::UUID);

CREATE POLICY client_isolation_workflow_logs ON workflow_logs
    USING (client_id = NULLIF(current_setting('app.current_client_id', true), '')::UUID);

CREATE POLICY client_isolation_ats_connections ON ats_connections
    USING (client_id = NULLIF(current_setting('app.current_client_id', true), '')::UUID);

CREATE POLICY client_isolation_recruiters ON recruiters
    USING (client_id = NULLIF(current_setting('app.current_client_id', true), '')::UUID);

CREATE POLICY client_isolation_outreach_templates ON outreach_templates
    USING (client_id IS NULL OR client_id = NULLIF(current_setting('app.current_client_id', true), '')::UUID);

-- Allow service role to bypass RLS (for system-level operations)
-- The API server connects with a service role that has BYPASSRLS

-- ============================================
-- VIEWS: واجهات عرض مفيدة
-- ============================================

-- Campaign dashboard view
CREATE OR REPLACE VIEW campaign_dashboard AS
SELECT 
    c.id,
    c.client_id,
    c.name,
    c.status,
    c.campaign_type,
    c.started_at,
    cl.name as client_name,
    jo.title as job_title,
    (c.stats->>'total_targeted')::INTEGER as total_targeted,
    (c.stats->>'total_contacted')::INTEGER as total_contacted,
    (c.stats->>'total_responded')::INTEGER as total_responded,
    (c.stats->>'total_qualified')::INTEGER as total_qualified,
    (c.stats->>'total_scheduled')::INTEGER as total_scheduled,
    (c.stats->>'total_opted_out')::INTEGER as total_opted_out,
    CASE 
        WHEN (c.stats->>'total_contacted')::INTEGER > 0 
        THEN ROUND(((c.stats->>'total_responded')::NUMERIC / (c.stats->>'total_contacted')::NUMERIC) * 100, 2)
        ELSE 0 
    END as response_rate,
    CASE 
        WHEN (c.stats->>'total_responded')::INTEGER > 0 
        THEN ROUND(((c.stats->>'total_qualified')::NUMERIC / (c.stats->>'total_responded')::NUMERIC) * 100, 2)
        ELSE 0 
    END as qualification_rate
FROM campaigns c
LEFT JOIN clients cl ON c.client_id = cl.id
LEFT JOIN job_orders jo ON c.job_order_id = jo.id;

-- Daily activity summary
CREATE OR REPLACE VIEW daily_activity_summary AS
SELECT 
    client_id,
    DATE(attempted_at) as activity_date,
    channel,
    COUNT(*) FILTER (WHERE direction = 'outbound') as outbound_count,
    COUNT(*) FILTER (WHERE direction = 'inbound') as inbound_count,
    COUNT(*) FILTER (WHERE status = 'delivered') as delivered_count,
    COUNT(*) FILTER (WHERE status = 'answered') as answered_count,
    COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
    COUNT(*) FILTER (WHERE status = 'opted_out') as opt_out_count,
    AVG(call_duration_seconds) FILTER (WHERE channel = 'voice') as avg_call_duration
FROM contact_attempts
GROUP BY client_id, DATE(attempted_at), channel;
