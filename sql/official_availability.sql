-- ======================================================
-- ARAB AVAILABILITY MANAGEMENT
-- Run once in the ARAB PostgreSQL database.
-- ======================================================

CREATE TABLE IF NOT EXISTS public.official_availability (
    availabilityid SERIAL PRIMARY KEY,
    officialid INTEGER NOT NULL
        REFERENCES public.officials(officialid)
        ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    CONSTRAINT official_availability_valid_range
        CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_official_availability_officialid
    ON public.official_availability(officialid);

CREATE INDEX IF NOT EXISTS idx_official_availability_dates
    ON public.official_availability(start_date, end_date);
