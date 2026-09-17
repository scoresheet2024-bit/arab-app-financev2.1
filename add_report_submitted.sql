-- Run this once in the ARAB PostgreSQL database.
ALTER TABLE public.games
ADD COLUMN IF NOT EXISTS report_submitted BOOLEAN DEFAULT FALSE;

-- Existing assigned games are kept assigned, but they have not gone
-- through the new final-report workflow yet.
UPDATE public.games
SET report_submitted = FALSE
WHERE report_submitted IS NULL;
