-- ============================================
-- Migration 006: Create Appointments
-- Stratton Candidate Engine
-- ============================================

-- ============================================
-- APPOINTMENTS: مواعيد المقابلات
-- ============================================
CREATE TABLE IF NOT EXISTS appointments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    candidate_id        UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
    recruiter_id        UUID NOT NULL REFERENCES recruiters(id) ON DELETE CASCADE,
    campaign_id         UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    job_order_id        UUID REFERENCES job_orders(id) ON DELETE SET NULL,
    
    -- Scheduling
    scheduled_start     TIMESTAMPTZ NOT NULL,
    scheduled_end       TIMESTAMPTZ NOT NULL,
    timezone            VARCHAR(50) NOT NULL DEFAULT 'America/New_York',
    duration_minutes    INTEGER NOT NULL DEFAULT 30,
    
    -- Calendar Integration
    calendar_type       VARCHAR(20) CHECK (calendar_type IN ('google', 'microsoft')),
    calendar_event_id   VARCHAR(500),
    calendar_link       TEXT,
    
    -- Meeting Details
    meeting_type        VARCHAR(30) NOT NULL DEFAULT 'phone' CHECK (meeting_type IN (
                            'phone', 'video', 'in_person'
                        )),
    meeting_link        TEXT,
    meeting_location    TEXT,
    meeting_phone       VARCHAR(50),
    
    -- Status
    status              VARCHAR(30) NOT NULL DEFAULT 'scheduled' CHECK (status IN (
                            'scheduled', 'confirmed', 'reminded',
                            'completed', 'cancelled', 'no_show', 'rescheduled'
                        )),
    
    -- Notifications
    candidate_notified  BOOLEAN DEFAULT false,
    recruiter_notified  BOOLEAN DEFAULT false,
    reminder_sent       BOOLEAN DEFAULT false,
    reminder_sent_at    TIMESTAMPTZ,
    
    -- Notes
    notes               TEXT,
    cancellation_reason TEXT,
    outcome             VARCHAR(50),
    outcome_notes       TEXT,
    
    -- ATS Sync
    ats_appointment_id  VARCHAR(255),
    synced_to_ats       BOOLEAN DEFAULT false,
    synced_at           TIMESTAMPTZ,
    
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_appointments_client ON appointments(client_id);
CREATE INDEX idx_appointments_candidate ON appointments(candidate_id);
CREATE INDEX idx_appointments_recruiter ON appointments(recruiter_id);
CREATE INDEX idx_appointments_campaign ON appointments(campaign_id);
CREATE INDEX idx_appointments_status ON appointments(status);
CREATE INDEX idx_appointments_scheduled ON appointments(scheduled_start);
CREATE INDEX idx_appointments_calendar ON appointments(calendar_event_id) WHERE calendar_event_id IS NOT NULL;

-- ============================================
-- RECRUITER_AVAILABILITY: أوقات توفر المُوظِّفين
-- ============================================
CREATE TABLE IF NOT EXISTS recruiter_availability (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recruiter_id    UUID NOT NULL REFERENCES recruiters(id) ON DELETE CASCADE,
    
    -- Weekly recurring availability
    day_of_week     INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    
    -- Slot configuration
    slot_duration_minutes INTEGER NOT NULL DEFAULT 30,
    buffer_minutes  INTEGER NOT NULL DEFAULT 10,
    max_per_day     INTEGER DEFAULT 10,
    
    is_active       BOOLEAN NOT NULL DEFAULT true,
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(recruiter_id, day_of_week, start_time)
);

CREATE INDEX idx_recruiter_availability_recruiter ON recruiter_availability(recruiter_id);

-- ============================================
-- RECRUITER_BLOCKED_TIMES: أوقات الحظر
-- ============================================
CREATE TABLE IF NOT EXISTS recruiter_blocked_times (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recruiter_id    UUID NOT NULL REFERENCES recruiters(id) ON DELETE CASCADE,
    
    blocked_start   TIMESTAMPTZ NOT NULL,
    blocked_end     TIMESTAMPTZ NOT NULL,
    reason          VARCHAR(255),
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_blocked_times_recruiter ON recruiter_blocked_times(recruiter_id);
CREATE INDEX idx_blocked_times_range ON recruiter_blocked_times(blocked_start, blocked_end);

-- ============================================
-- Function: Find available slots
-- ============================================
CREATE OR REPLACE FUNCTION find_available_slots(
    p_recruiter_id UUID,
    p_date DATE,
    p_duration_minutes INTEGER DEFAULT 30
) RETURNS TABLE(slot_start TIMESTAMPTZ, slot_end TIMESTAMPTZ) AS $$
DECLARE
    v_availability RECORD;
    v_current_slot TIMESTAMPTZ;
    v_slot_end TIMESTAMPTZ;
    v_recruiter_tz VARCHAR(50);
BEGIN
    -- Get recruiter timezone
    SELECT r.calendar_id INTO v_recruiter_tz 
    FROM recruiters r WHERE r.id = p_recruiter_id;
    v_recruiter_tz := COALESCE(v_recruiter_tz, 'America/New_York');
    
    -- Get availability for this day of week
    FOR v_availability IN 
        SELECT * FROM recruiter_availability ra
        WHERE ra.recruiter_id = p_recruiter_id
          AND ra.day_of_week = EXTRACT(DOW FROM p_date)
          AND ra.is_active = true
    LOOP
        v_current_slot := (p_date || ' ' || v_availability.start_time)::TIMESTAMPTZ;
        
        WHILE v_current_slot + (p_duration_minutes || ' minutes')::INTERVAL 
              <= (p_date || ' ' || v_availability.end_time)::TIMESTAMPTZ
        LOOP
            v_slot_end := v_current_slot + (p_duration_minutes || ' minutes')::INTERVAL;
            
            -- Check for existing appointments
            IF NOT EXISTS (
                SELECT 1 FROM appointments a
                WHERE a.recruiter_id = p_recruiter_id
                  AND a.status NOT IN ('cancelled', 'rescheduled')
                  AND a.scheduled_start < v_slot_end
                  AND a.scheduled_end > v_current_slot
            )
            -- Check for blocked times
            AND NOT EXISTS (
                SELECT 1 FROM recruiter_blocked_times bt
                WHERE bt.recruiter_id = p_recruiter_id
                  AND bt.blocked_start < v_slot_end
                  AND bt.blocked_end > v_current_slot
            )
            THEN
                slot_start := v_current_slot;
                slot_end := v_slot_end;
                RETURN NEXT;
            END IF;
            
            v_current_slot := v_current_slot + 
                ((p_duration_minutes + v_availability.buffer_minutes) || ' minutes')::INTERVAL;
        END LOOP;
    END LOOP;
END;
$$ LANGUAGE plpgsql STABLE;

-- Triggers
CREATE TRIGGER update_appointments_updated_at BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
