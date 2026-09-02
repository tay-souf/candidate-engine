-- ============================================
-- Migration 002: Create Campaigns & Job Orders
-- Stratton Candidate Engine
-- ============================================

-- ============================================
-- JOB_ORDERS: طلبات التوظيف المسحوبة من ATS
-- ============================================
CREATE TABLE IF NOT EXISTS job_orders (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    ats_job_id          VARCHAR(255) NOT NULL,
    title               VARCHAR(500) NOT NULL,
    description         TEXT,
    requirements        JSONB DEFAULT '{}',
    location            VARCHAR(500),
    location_lat        DECIMAL(10,7),
    location_lng        DECIMAL(10,7),
    job_type            VARCHAR(50),
    pay_rate_min        DECIMAL(10,2),
    pay_rate_max        DECIMAL(10,2),
    pay_type            VARCHAR(20) CHECK (pay_type IN ('hourly', 'salary', 'contract', 'per_diem')),
    shift               VARCHAR(100),
    start_date          DATE,
    end_date            DATE,
    openings            INTEGER DEFAULT 1,
    filled              INTEGER DEFAULT 0,
    skills_required     TEXT[] DEFAULT '{}',
    certifications_required TEXT[] DEFAULT '{}',
    experience_min_years INTEGER DEFAULT 0,
    status              VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (status IN (
                            'active', 'paused', 'filled', 'closed', 'cancelled'
                        )),
    assigned_recruiter_id UUID REFERENCES recruiters(id),
    priority            INTEGER DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
    raw_data            JSONB DEFAULT '{}',
    synced_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(client_id, ats_job_id)
);

CREATE INDEX idx_job_orders_client ON job_orders(client_id);
CREATE INDEX idx_job_orders_status ON job_orders(status);
CREATE INDEX idx_job_orders_ats_id ON job_orders(client_id, ats_job_id);
CREATE INDEX idx_job_orders_skills ON job_orders USING GIN(skills_required);

-- ============================================
-- CAMPAIGNS: حملات التواصل
-- ============================================
CREATE TABLE IF NOT EXISTS campaigns (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    job_order_id            UUID REFERENCES job_orders(id) ON DELETE SET NULL,
    name                    VARCHAR(255) NOT NULL,
    description             TEXT,
    status                  VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN (
                                'draft', 'active', 'paused', 'completed', 
                                'cancelled', 'error'
                            )),
    campaign_type           VARCHAR(30) NOT NULL DEFAULT 'outreach' CHECK (campaign_type IN (
                                'outreach', 'follow_up', 're_engagement', 'survey'
                            )),
    
    -- Outreach Configuration
    outreach_channels       VARCHAR(20)[] NOT NULL DEFAULT '{sms}',
    sms_template_id         UUID,
    voice_template_id       UUID,
    email_template_id       UUID,
    
    -- Sequence Configuration
    sequence_config         JSONB NOT NULL DEFAULT '{
        "steps": [
            {"channel": "sms", "delay_hours": 0, "template": "initial_sms"},
            {"channel": "voice", "delay_hours": 4, "template": "initial_call"},
            {"channel": "sms", "delay_hours": 24, "template": "follow_up_sms"},
            {"channel": "voice", "delay_hours": 48, "template": "follow_up_call"},
            {"channel": "sms", "delay_hours": 72, "template": "final_sms"}
        ],
        "max_attempts_per_channel": 3,
        "cooldown_hours": 24,
        "stop_on_response": true,
        "stop_on_opt_out": true
    }',
    
    -- Qualification Criteria
    qualification_criteria  JSONB NOT NULL DEFAULT '{}',
    
    -- Targeting
    target_query            JSONB DEFAULT '{}',
    max_candidates          INTEGER,
    
    -- Statistics (denormalized for quick access)
    stats                   JSONB NOT NULL DEFAULT '{
        "total_targeted": 0,
        "total_contacted": 0,
        "total_responded": 0,
        "total_qualified": 0,
        "total_scheduled": 0,
        "total_opted_out": 0,
        "total_failed": 0
    }',
    
    -- Scheduling
    scheduled_start         TIMESTAMPTZ,
    scheduled_end           TIMESTAMPTZ,
    started_at              TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,
    
    created_by              VARCHAR(255),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_client ON campaigns(client_id);
CREATE INDEX idx_campaigns_status ON campaigns(status);
CREATE INDEX idx_campaigns_job_order ON campaigns(job_order_id);
CREATE INDEX idx_campaigns_type ON campaigns(campaign_type);

-- ============================================
-- OUTREACH_TEMPLATES: قوالب التواصل
-- ============================================
CREATE TABLE IF NOT EXISTS outreach_templates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    channel         VARCHAR(20) NOT NULL CHECK (channel IN ('sms', 'voice', 'email')),
    template_type   VARCHAR(30) NOT NULL CHECK (template_type IN (
                        'initial_outreach', 'follow_up', 'qualification',
                        'scheduling', 'confirmation', 'opt_out_confirm'
                    )),
    subject         VARCHAR(500),
    body            TEXT NOT NULL,
    variables       TEXT[] DEFAULT '{}',
    voice_prompt    TEXT,
    is_default      BOOLEAN DEFAULT false,
    is_active       BOOLEAN DEFAULT true,
    language        VARCHAR(10) DEFAULT 'en',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outreach_templates_client ON outreach_templates(client_id);
CREATE INDEX idx_outreach_templates_channel ON outreach_templates(channel);

-- Triggers
CREATE TRIGGER update_job_orders_updated_at BEFORE UPDATE ON job_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON campaigns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_outreach_templates_updated_at BEFORE UPDATE ON outreach_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
