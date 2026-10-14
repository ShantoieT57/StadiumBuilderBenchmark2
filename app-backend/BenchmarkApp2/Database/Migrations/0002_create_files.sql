-- One row per uploaded file. The exact original bytes are kept so the file can be downloaded or
-- discarded later, with a SHA-256 hash of them for the duplicate check. A file is received with the
-- status 'Uploaded'; a background processor later picks up uploaded files and moves them on to
-- 'Processing' and then 'Completed' or 'Failed'.
CREATE TABLE files (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name      text        NOT NULL,
    kind           text        NOT NULL CHECK (kind IN ('BankTransactions')),
    status         text        NOT NULL CHECK (status IN ('Uploaded', 'Processing', 'Completed', 'Failed')),
    content        bytea       NOT NULL,
    content_sha256 bytea       NOT NULL,
    uploaded_by    uuid        NOT NULL REFERENCES users (id),
    uploaded_at    timestamptz NOT NULL
);

-- The files waiting to be processed, oldest first.
CREATE INDEX files_awaiting_processing ON files (uploaded_at) WHERE status = 'Uploaded';

-- Finds earlier files with identical content.
CREATE INDEX files_content_sha256 ON files (content_sha256);
