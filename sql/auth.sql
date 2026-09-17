-- ======================================================
-- ARAB STEP 2: LOGIN AND USER MANAGEMENT
-- Run this script once in the arab_db PostgreSQL database.
-- ======================================================

CREATE TABLE IF NOT EXISTS public.users (
    userid SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    fullname VARCHAR(200) NOT NULL,
    role VARCHAR(30) NOT NULL
        CHECK (role IN ('admin', 'to', 'official', 'finance')),
    officialid INTEGER NULL
        REFERENCES public.officials(officialid)
        ON DELETE SET NULL,
    password_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.user_sessions (
    sessionid VARCHAR(64) PRIMARY KEY,
    userid INTEGER NOT NULL
        REFERENCES public.users(userid)
        ON DELETE CASCADE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_userid
    ON public.user_sessions(userid);

CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at
    ON public.user_sessions(expires_at);

-- Optional cleanup of expired sessions. The application also ignores expired sessions.
DELETE FROM public.user_sessions
WHERE expires_at <= NOW();

-- IMPORTANT:
-- Do NOT insert a plaintext password into this table.
-- After running this SQL, create the first administrator with:
--
--   node scripts/createAdmin.js
--
