CREATE TABLE users (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    name          text        NOT NULL,
    email         text        NOT NULL,
    role          text        NOT NULL CHECK (role IN ('Importer', 'Approver')),
    password_hash text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Email addresses are unique regardless of upper and lower case.
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

-- One row per sign-in. Only a SHA-256 hash of the session token is stored.
-- last_activity_at supports an inactivity timeout, and ended_at / end_reason record how a
-- session ended (signed out, replaced by a newer sign-in, timed out), so single-session and
-- sign-out-everywhere rules only need to update the active rows for a user.
CREATE TABLE sessions (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          uuid        NOT NULL REFERENCES users (id),
    token_hash       bytea       NOT NULL UNIQUE,
    created_at       timestamptz NOT NULL DEFAULT now(),
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    ended_at         timestamptz NULL,
    end_reason       text        NULL
);

CREATE INDEX sessions_active_by_user ON sessions (user_id) WHERE ended_at IS NULL;

-- Seed users. Both passwords are "Test123", hashed with ASP.NET Core Identity's PasswordHasher
-- (PBKDF2 with HMAC-SHA512, 100,000 iterations, random 128-bit salt).
INSERT INTO users (name, email, role, password_hash) VALUES
    ('File Importer', 'fileimporter@digiata.com', 'Importer',
     'AQAAAAIAAYagAAAAEFOpFIs0+hWvl8pTdfLClZgcd1nTuHWHX283zosLLzCBDFKEWuE3oSmrYUOVTWv1Kg=='),
    ('Approver User', 'approver@digiata.com', 'Approver',
     'AQAAAAIAAYagAAAAENJVOm46yVygWblOcKJC7EFL0BNPzP2LeHZuHdOZs8Aws80xJJVGFKujBTUyrj0bvw==');
