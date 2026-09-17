-- ======================================================
-- ARAB FINANCE - CATEGORY PAYMENT RATES MIGRATION
-- Existing finance.sql has already been installed.
-- Run this script once in arab_db to switch rates to
-- the 3 official categories and add category history.
-- ======================================================

ALTER TABLE public.finance_payment_rates
    ADD COLUMN IF NOT EXISTS category VARCHAR(50);

ALTER TABLE public.finance_payment_items
    ADD COLUMN IF NOT EXISTS category VARCHAR(50);

-- Map the existing assignment roles into the three categories.
UPDATE public.finance_payment_rates
SET category = CASE
    WHEN LOWER(role) IN ('referee', 'umpire 1', 'umpire 2') THEN 'Referee'
    WHEN LOWER(role) IN ('scorer', 'timer', 'shot clock operator', 'assistant scorer') THEN 'T.O'
    WHEN LOWER(role) = 'commissioner' THEN 'Commissioners'
    ELSE role
END;

-- Apply the approved ARAB rates supplied for this project.
UPDATE public.finance_payment_rates
SET amount = CASE category
    WHEN 'Referee' THEN 10500
    WHEN 'T.O' THEN 8500
    WHEN 'Commissioners' THEN 10500
    ELSE amount
END
WHERE category IN ('Referee', 'T.O', 'Commissioners');

-- Keep one rate row per category.
DELETE FROM public.finance_payment_rates a
USING public.finance_payment_rates b
WHERE a.category IN ('Referee', 'T.O', 'Commissioners')
  AND b.category = a.category
  AND a.rateid > b.rateid;

-- Add any missing category rows.
INSERT INTO public.finance_payment_rates (role, category, amount, active)
VALUES
    ('Referee', 'Referee', 10500, TRUE),
    ('T.O', 'T.O', 8500, TRUE),
    ('Commissioners', 'Commissioners', 10500, TRUE)
ON CONFLICT (role) DO UPDATE SET
    category = EXCLUDED.category,
    amount = EXCLUDED.amount,
    active = TRUE,
    updated_at = CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS uq_finance_payment_rates_category
    ON public.finance_payment_rates(category);

-- Payment items keep the category that was used at payment time.
UPDATE public.finance_payment_items fpi
SET category = CASE
    WHEN LOWER(fpi.role) IN ('referee', 'umpire 1', 'umpire 2') THEN 'Referee'
    WHEN LOWER(fpi.role) IN ('scorer', 'timer', 'shot clock operator', 'assistant scorer') THEN 'T.O'
    WHEN LOWER(fpi.role) = 'commissioner' THEN 'Commissioners'
    ELSE fpi.role
END
WHERE fpi.category IS NULL;
