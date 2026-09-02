-- ============================================
-- Migration 004: Create Contact Attempts
-- Stratton Candidate Engine
-- ============================================

-- ============================================
-- CONTACT_ATTEMPTS: محاولات التواصل
-- ============================================
CREATE TABLE IF NOT EXISTS contact_attempts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    candidate_id        UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    campaign_id         UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    
    -- Contact Details
    channel             VARCHAR(20) NOT NULL CHECK (channel IN ('sms', 'voice', 'email')),
    direction           VARCHAR(10) NOT NULL CHECK (direction IN ('outbound', 'inbound')),
    sequence_step       INTEGER,
    
    -- Identifiers
    idempotency_key     VARCHAR(255) NOT NULL UNIQUE,
    external_id         VARCHAR(255),
    
    -- Contact Info Used
    phone_used          VARCHAR(50),
    email_used          VARCHAR(255),
    
    -- Result
    status              VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN (
                            'pending', 'sent', 'delivered', 'failed',
                            'answered', 'no_answer', 'busy', 'voicemail',
                            'bounced', 'opened', 'clicked', 'replied',
                            'opted_out', 'error'
                        )),
    
    -- SMS Specific
    sms_sid             VARCHAR(255),
    sms_body            TEXT,
    sms_response        TEXT,
    
    -- Voice Specific
    call_sid            VARCHAR(255),
    call_duration_seconds INTEGER,
    call_recording_url  TEXT,
    call_transcript     TEXT,
    call_sentiment      VARCHAR(20),
    retell_call_id      VARCHAR(255),
    
    -- AI Analysis
    ai_summary          TEXT,
    ai_qualification    JSONB DEFAULT '{}',
    ai_intent           VARCHAR(50),
    ai_confidence       DECIMAL(3,2),
    
    -- Error Handling
    error_code          VARCHAR(50),
    error_message       TEXT,
    retry_count         INTEGER DEFAULT 0,
    max_retries         INTEGER DEFAULT 3,
    next_retry_at       TIMESTAMPTZ,
    
    -- Cost
    cost_amount         DECIMAL(10,4),
    cost_currency       VARCHAR(3) DEFAULT 'USD',
    
    -- Timestamps
    scheduled_at        TIMESTAMPTZ,
    attempted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX idx_contact_attempts_client ON contact_attempts(client_id);
CREATE INDEX idx_contact_attempts_candidate ON contact_attempts(candidate_id);
CREATE INDEX idx_contact_attempts_campaign ON contact_attempts(campaign_id);
CREATE INDEX idx_contact_attempts_channel ON contact_attempts(channel);
CREATE INDEX idx_contact_attempts_status ON contact_attempts(status);
CREATE INDEX idx_contact_attempts_idempotency ON contact_attempts(idempotency_key);
CREATE INDEX idx_contact_attempts_retell ON contact_attempts(retell_call_id) WHERE retell_call_id IS NOT NULL;
CREATE INDEX idx_contact_attempts_sms_sid ON contact_attempts(sms_sid) WHERE sms_sid IS NOT NULL;
CREATE INDEX idx_contact_attempts_retry ON contact_attempts(next_retry_at) WHERE status = 'error' AND retry_count < max_retries;
CREATE INDEX idx_contact_attempts_date ON contact_attempts(attempted_at);

-- ============================================
-- OPT_OUTS: المنسحبون من التواصل
-- ============================================
CREATE TABLE IF NOT EXISTS opt_outs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    candidate_id    UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    
    channel         VARCHAR(20) NOT NULL CHECK (channel IN ('sms', 'voice', 'email', 'all')),
    reason          VARCHAR(100),
    source          VARCHAR(50) CHECK (source IN (
                        'sms_reply', 'voice_request', 'email_unsubscribe',
                        'manual', 'regulatory', 'complaint'
                    )),
    
    -- The message/call that triggered the opt-out
    contact_attempt_id UUID REFERENCES contact_attempts(id),
    
    opted_out_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Allow re-opt-in
    is_active       BOOLEAN NOT NULL DEFAULT true,
    revoked_at      TIMESTAMPTZ,
    revoked_reason  TEXT,
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(client_id, candidate_id, channel)
);

CREATE INDEX idx_opt_outs_client ON opt_outs(client_id);
CREATE INDEX idx_opt_outs_candidate ON opt_outs(candidate_id);
CREATE INDEX idx_opt_outs_active ON opt_outs(candidate_id, channel) WHERE is_active = true;

-- ============================================
-- Function: Check if candidate opted out
-- ============================================
CREATE OR REPLACE FUNCTION is_opted_out(
    p_candidate_id UUID,
    p_channel VARCHAR DEFAULT NULL
) RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM opt_outs
        WHERE candidate_id = p_candidate_id
          AND is_active = true
          AND (channel = 'all' OR channel = COALESCE(p_channel, channel))
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- Function: Check duplicate contact
-- ============================================
CREATE OR REPLACE FUNCTION check_duplicate_contact(
    p_candidate_id UUID,
    p_campaign_id UUID,
    p_channel VARCHAR,
    p_cooldown_hours INTEGER DEFAULT 24
) RETURNS BOOLEAN AS $$
DECLARE
    last_attempt TIMESTAMPTZ;
BEGIN
    -- Check opt-out first
    IF is_opted_out(p_candidate_id, p_channel) THEN
        RETURN FALSE;
    END IF;
    
    -- Check last contact attempt on this channel
    SELECT MAX(attempted_at) INTO last_attempt
    FROM contact_attempts
    WHERE candidate_id = p_candidate_id
      AND campaign_id = p_campaign_id
      AND channel = p_channel
      AND status NOT IN ('failed', 'error');
    
    -- Allow contact only after cooldown period
    IF last_attempt IS NOT NULL 
       AND last_attempt > NOW() - make_interval(hours => p_cooldown_hours)
    THEN
        RETURN FALSE;
    END IF;
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================
-- Function: Auto opt-out on keyword detection
-- ============================================
CREATE OR REPLACE FUNCTION process_opt_out_keywords()
RETURNS TRIGGER AS $$
DECLARE
    opt_out_keywords TEXT[] := ARRAY['stop', 'unsubscribe', 'opt out', 'optout', 
                                     'cancel', 'remove', 'quit', 'end'];
    response_lower TEXT;
BEGIN
    IF NEW.direction = 'inbound' AND NEW.channel = 'sms' AND NEW.sms_response IS NOT NULL THEN
        response_lower := lower(trim(NEW.sms_response));
        
        IF response_lower = ANY(opt_out_keywords) THEN
            -- Record opt-out
            INSERT INTO opt_outs (client_id, candidate_id, channel, reason, source, contact_attempt_id)
            VALUES (NEW.client_id, NEW.candidate_id, 'sms', 'keyword: ' || response_lower, 
                    'sms_reply', NEW.id)
            ON CONFLICT (client_id, candidate_id, channel) DO UPDATE
            SET is_active = true, opted_out_at = NOW(), 
                reason = 'keyword: ' || response_lower;
            
            -- Update candidate status
            UPDATE candidates SET status = 'opted_out' 
            WHERE id = NEW.candidate_id;
            
            -- Mark all pending campaign enrollments as opted out
            UPDATE campaign_candidates 
            SET status = 'opted_out', completed_at = NOW()
            WHERE candidate_id = NEW.candidate_id 
              AND status IN ('pending', 'in_sequence');
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_process_opt_out
    AFTER INSERT ON contact_attempts
    FOR EACH ROW
    WHEN (NEW.direction = 'inbound')
    EXECUTE FUNCTION process_opt_out_keywords();

-- ============================================
-- Trigger: Update candidate contact stats
-- ============================================
CREATE OR REPLACE FUNCTION update_candidate_contact_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.direction = 'outbound' THEN
        UPDATE candidates 
        SET total_contact_attempts = total_contact_attempts + 1,
            last_contacted_at = NEW.attempted_at
        WHERE id = NEW.candidate_id;
    ELSIF NEW.direction = 'inbound' THEN
        UPDATE candidates 
        SET total_responses = total_responses + 1,
            last_responded_at = NEW.attempted_at,
            status = CASE 
                WHEN status = 'new' THEN 'engaged'
                WHEN status = 'contacted' THEN 'engaged'
                ELSE status
            END
        WHERE id = NEW.candidate_id;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_contact_stats
    AFTER INSERT ON contact_attempts
    FOR EACH ROW EXECUTE FUNCTION update_candidate_contact_stats();
