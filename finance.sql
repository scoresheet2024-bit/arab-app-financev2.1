-- ======================================================
-- ARAB FINANCE MODULE
-- Run this once in the arab_db PostgreSQL database.
-- ======================================================

ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) NOT NULL DEFAULT 'UNPAID';

ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP NULL;

ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS paymentid INTEGER NULL;

CREATE TABLE IF NOT EXISTS public.finance_payment_rates (
    rateid SERIAL PRIMARY KEY,
    role VARCHAR(100) NOT NULL UNIQUE,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.finance_payments (
    paymentid SERIAL PRIMARY KEY,
    payment_reference VARCHAR(100) NOT NULL UNIQUE,
    payment_status VARCHAR(30) NOT NULL DEFAULT 'PAID',
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    payment_method VARCHAR(50) NOT NULL DEFAULT 'Manual',
    paid_at TIMESTAMP NULL,
    notes TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.finance_payment_items (
    payment_item_id SERIAL PRIMARY KEY,
    paymentid INTEGER NOT NULL REFERENCES public.finance_payments(paymentid) ON DELETE CASCADE,
    gameid INTEGER NOT NULL REFERENCES public.games(gameid) ON DELETE RESTRICT,
    officialid INTEGER NOT NULL REFERENCES public.officials(officialid) ON DELETE RESTRICT,
    role VARCHAR(100) NOT NULL,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_finance_payment_items_gameid
    ON public.finance_payment_items(gameid);

CREATE INDEX IF NOT EXISTS idx_finance_payment_items_officialid
    ON public.finance_payment_items(officialid);

-- Optional starting payment rates. Change the amounts to your approved ARAB rates.
INSERT INTO public.finance_payment_rates (role, amount)
VALUES
    ('Referee', 0),
    ('Umpire 1', 0),
    ('Umpire 2', 0),
    ('Scorer', 0),
    ('Timer', 0),
    ('Shot Clock Operator', 0),
    ('Assistant Scorer', 0),
    ('Commissioner', 0)
ON CONFLICT (role) DO NOTHING;
