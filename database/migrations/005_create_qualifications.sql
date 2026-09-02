-- ============================================
-- Migration 005: Create Qualifications
-- Stratton Candidate Engine
-- ============================================

-- ============================================
-- QUALIFICATIONS: نتائج التأهيل
-- ============================================
CREATE TABLE IF NOT EXISTS qualifications (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    candidate_id        UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    campaign_id         UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    job_order_id        UUID REFERENCES job_orders(id) ON DELETE SET NULL,
    
    -- Qualification Result
    qualified           BOOLEAN NOT NULL,
    overall_score       DECIMAL(5,2) NOT NULL DEFAULT 0,
    
    -- Criteria Results
    criteria_results    JSONB NOT NULL DEFAULT '[]',
    /*
        Example criteria_results:
        [
            {
                "criterion": "experience_years",
                "required": 3,
                "actual": 5,
                "passed": true,
                "weight": 0.3
            },
            {
                "criterion": "location_radius",
                "required": 50,
                "actual": 25,
                "passed": true,
                "weight": 0.2
            },
            {
                "criterion": "certifications",
                "required": ["CNA"],
                "actual": ["CNA", "BLS"],
                "passed": true,
                "weight": 0.25
            },
            {
                "criterion": "availability",
                "required": ["immediate", "2_weeks"],
                "actual": "immediate",
                "passed": true,
                "weight": 0.25
            }
        ]
    */
    
    -- AI Analysis
    ai_analysis         JSONB DEFAULT '{}',
    ai_summary          TEXT,
    ai_confidence       DECIMAL(3,2),
    
    -- Source
    source              VARCHAR(30) CHECK (source IN (
                            'voice_call', 'sms_conversation', 'manual',
                            'ai_analysis', 'ats_data'
                        )),
    source_contact_attempt_id UUID REFERENCES contact_attempts(id),
    
    -- Decision
    reviewed_by         VARCHAR(255),
    reviewed_at         TIMESTAMPTZ,
    override_qualified  BOOLEAN,
    override_reason     TEXT,
    
    qualified_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qualifications_client ON qualifications(client_id);
CREATE INDEX idx_qualifications_candidate ON qualifications(candidate_id);
CREATE INDEX idx_qualifications_campaign ON qualifications(campaign_id);
CREATE INDEX idx_qualifications_qualified ON qualifications(qualified);
CREATE INDEX idx_qualifications_score ON qualifications(overall_score DESC);

-- ============================================
-- QUALIFICATION_TEMPLATES: قوالب معايير التأهيل
-- ============================================
CREATE TABLE IF NOT EXISTS qualification_templates (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id       UUID REFERENCES clients(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    job_category    VARCHAR(100),
    
    criteria        JSONB NOT NULL DEFAULT '[]',
    /*
        Example criteria:
        [
            {
                "field": "experience_years",
                "operator": ">=",
                "value": 2,
                "weight": 0.3,
                "required": true,
                "label": "Minimum Experience"
            },
            {
                "field": "skills",
                "operator": "contains_any",
                "value": ["JavaScript", "Python", "Java"],
                "weight": 0.25,
                "required": false,
                "label": "Technical Skills"
            },
            {
                "field": "location_radius_miles",
                "operator": "<=",
                "value": 50,
                "weight": 0.2,
                "required": true,
                "label": "Location Proximity"
            },
            {
                "field": "availability",
                "operator": "in",
                "value": ["immediate", "1_week", "2_weeks"],
                "weight": 0.15,
                "required": true,
                "label": "Availability"
            },
            {
                "field": "certifications",
                "operator": "contains_all",
                "value": ["CNA"],
                "weight": 0.1,
                "required": false,
                "label": "Required Certifications"
            }
        ]
    */
    
    passing_score   DECIMAL(5,2) NOT NULL DEFAULT 70.00,
    is_default      BOOLEAN DEFAULT false,
    is_active       BOOLEAN DEFAULT true,
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_qualification_templates_client ON qualification_templates(client_id);
CREATE INDEX idx_qualification_templates_category ON qualification_templates(job_category);

-- Triggers
CREATE TRIGGER update_qualifications_updated_at BEFORE UPDATE ON qualifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_qualification_templates_updated_at BEFORE UPDATE ON qualification_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Function: Evaluate qualification criteria
-- ============================================
CREATE OR REPLACE FUNCTION evaluate_qualification(
    p_candidate_id UUID,
    p_template_id UUID
) RETURNS TABLE(qualified BOOLEAN, score DECIMAL, results JSONB) AS $$
DECLARE
    v_criteria JSONB;
    v_passing_score DECIMAL;
    v_candidate RECORD;
    v_results JSONB := '[]'::JSONB;
    v_total_score DECIMAL := 0;
    v_total_weight DECIMAL := 0;
    v_criterion JSONB;
    v_passed BOOLEAN;
    v_actual_value TEXT;
    v_all_required_passed BOOLEAN := true;
BEGIN
    -- Get template criteria
    SELECT qt.criteria, qt.passing_score INTO v_criteria, v_passing_score
    FROM qualification_templates qt WHERE qt.id = p_template_id;
    
    -- Get candidate data
    SELECT * INTO v_candidate FROM candidates c WHERE c.id = p_candidate_id;
    
    -- Evaluate each criterion
    FOR v_criterion IN SELECT * FROM jsonb_array_elements(v_criteria)
    LOOP
        v_passed := false;
        v_total_weight := v_total_weight + (v_criterion->>'weight')::DECIMAL;
        
        -- Simple field evaluation (extensible)
        CASE v_criterion->>'field'
            WHEN 'experience_years' THEN
                v_actual_value := v_candidate.experience_years::TEXT;
                IF v_criterion->>'operator' = '>=' THEN
                    v_passed := COALESCE(v_candidate.experience_years, 0) >= (v_criterion->>'value')::INTEGER;
                END IF;
            WHEN 'availability' THEN
                v_actual_value := v_candidate.availability;
                IF v_criterion->>'operator' = 'in' THEN
                    v_passed := v_candidate.availability = ANY(
                        ARRAY(SELECT jsonb_array_elements_text(v_criterion->'value'))
                    );
                END IF;
            ELSE
                v_passed := false;
                v_actual_value := 'unknown';
        END CASE;
        
        IF v_passed THEN
            v_total_score := v_total_score + (v_criterion->>'weight')::DECIMAL;
        ELSIF (v_criterion->>'required')::BOOLEAN THEN
            v_all_required_passed := false;
        END IF;
        
        v_results := v_results || jsonb_build_object(
            'criterion', v_criterion->>'field',
            'label', v_criterion->>'label',
            'passed', v_passed,
            'actual', v_actual_value,
            'required', COALESCE((v_criterion->>'required')::BOOLEAN, false),
            'weight', (v_criterion->>'weight')::DECIMAL
        );
    END LOOP;
    
    -- Calculate final score
    IF v_total_weight > 0 THEN
        score := (v_total_score / v_total_weight) * 100;
    ELSE
        score := 0;
    END IF;
    
    qualified := v_all_required_passed AND score >= v_passing_score;
    results := v_results;
    
    RETURN NEXT;
END;
$$ LANGUAGE plpgsql STABLE;
