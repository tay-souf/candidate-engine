-- ============================================
-- Migration 003: Create Candidates Table
-- Stratton Candidate Engine
-- ============================================

-- ============================================
-- CANDIDATES: المرشحون
-- ============================================
CREATE TABLE IF NOT EXISTS candidates (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    ats_candidate_id    VARCHAR(255) NOT NULL,
    
    -- Basic Info
    first_name          VARCHAR(255) NOT NULL,
    last_name           VARCHAR(255) NOT NULL,
    full_name           VARCHAR(500) GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
    email               VARCHAR(255),
    phone               VARCHAR(50),
    phone_normalized    VARCHAR(20),
    alt_phone           VARCHAR(50),
    
    -- Location
    address             TEXT,
    city                VARCHAR(255),
    state               VARCHAR(100),
    zip_code            VARCHAR(20),
    country             VARCHAR(100) DEFAULT 'US',
    location_lat        DECIMAL(10,7),
    location_lng        DECIMAL(10,7),
    
    -- Professional
    current_title       VARCHAR(500),
    skills              TEXT[] DEFAULT '{}',
    certifications      TEXT[] DEFAULT '{}',
    experience_years    INTEGER,
    education_level     VARCHAR(100),
    desired_pay_rate    DECIMAL(10,2),
    desired_pay_type    VARCHAR(20),
    availability        VARCHAR(50) CHECK (availability IN (
                            'immediate', '1_week', '2_weeks', '1_month', 
                            'not_available', 'unknown'
                        )),
    work_authorization  VARCHAR(50),
    willing_to_relocate BOOLEAN DEFAULT false,
    preferred_shift     VARCHAR(100),
    travel_radius_miles INTEGER,
    
    -- Status
    status              VARCHAR(30) NOT NULL DEFAULT 'new' CHECK (status IN (
                            'new', 'contacted', 'engaged', 'qualified',
                            'scheduled', 'placed', 'not_interested',
                            'not_qualified', 'opted_out', 'do_not_contact'
                        )),
    
    -- Engagement Tracking
    last_contacted_at   TIMESTAMPTZ,
    last_responded_at   TIMESTAMPTZ,
    total_contact_attempts INTEGER DEFAULT 0,
    total_responses     INTEGER DEFAULT 0,
    preferred_channel   VARCHAR(20),
    
    -- Source Data
    source              VARCHAR(100),
    tags                TEXT[] DEFAULT '{}',
    notes               TEXT,
    raw_data            JSONB DEFAULT '{}',
    normalized_data     JSONB DEFAULT '{}',
    
    -- Sync
    synced_at           TIMESTAMPTZ,
    ats_updated_at      TIMESTAMPTZ,
    
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Unique candidate per client per ATS
    UNIQUE(client_id, ats_candidate_id)
);

-- Performance indexes
CREATE INDEX idx_candidates_client ON candidates(client_id);
CREATE INDEX idx_candidates_status ON candidates(status);
CREATE INDEX idx_candidates_phone ON candidates(phone_normalized);
CREATE INDEX idx_candidates_email ON candidates(email);
CREATE INDEX idx_candidates_ats_id ON candidates(client_id, ats_candidate_id);
CREATE INDEX idx_candidates_skills ON candidates USING GIN(skills);
CREATE INDEX idx_candidates_certs ON candidates USING GIN(certifications);
CREATE INDEX idx_candidates_tags ON candidates USING GIN(tags);
CREATE INDEX idx_candidates_location ON candidates(city, state);
CREATE INDEX idx_candidates_last_contact ON candidates(last_contacted_at);

-- Full text search index
CREATE INDEX idx_candidates_fts ON candidates USING GIN(
    to_tsvector('english', coalesce(first_name, '') || ' ' || 
    coalesce(last_name, '') || ' ' || 
    coalesce(current_title, '') || ' ' ||
    coalesce(city, ''))
);

-- ============================================
-- CAMPAIGN_CANDIDATES: ربط المرشحين بالحملات
-- ============================================
CREATE TABLE IF NOT EXISTS campaign_candidates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    candidate_id    UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    
    status          VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN (
                        'pending', 'in_sequence', 'responded', 'qualified',
                        'not_qualified', 'scheduled', 'opted_out',
                        'completed', 'failed', 'skipped'
                    )),
    
    current_sequence_step INTEGER DEFAULT 0,
    next_action_at      TIMESTAMPTZ,
    
    qualification_score DECIMAL(5,2),
    qualification_data  JSONB DEFAULT '{}',
    
    enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    
    UNIQUE(campaign_id, candidate_id)
);

CREATE INDEX idx_campaign_candidates_campaign ON campaign_candidates(campaign_id);
CREATE INDEX idx_campaign_candidates_candidate ON campaign_candidates(candidate_id);
CREATE INDEX idx_campaign_candidates_status ON campaign_candidates(status);
CREATE INDEX idx_campaign_candidates_next_action ON campaign_candidates(next_action_at)
    WHERE status IN ('pending', 'in_sequence');

-- Triggers
CREATE TRIGGER update_candidates_updated_at BEFORE UPDATE ON candidates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Function: Normalize phone number
-- ============================================
CREATE OR REPLACE FUNCTION normalize_phone_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.phone IS NOT NULL THEN
        -- Remove all non-numeric characters except +
        NEW.phone_normalized = regexp_replace(NEW.phone, '[^0-9+]', '', 'g');
        -- Ensure +1 prefix for US numbers
        IF length(NEW.phone_normalized) = 10 THEN
            NEW.phone_normalized = '+1' || NEW.phone_normalized;
        ELSIF length(NEW.phone_normalized) = 11 AND left(NEW.phone_normalized, 1) = '1' THEN
            NEW.phone_normalized = '+' || NEW.phone_normalized;
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER normalize_candidate_phone
    BEFORE INSERT OR UPDATE OF phone ON candidates
    FOR EACH ROW EXECUTE FUNCTION normalize_phone_number();
