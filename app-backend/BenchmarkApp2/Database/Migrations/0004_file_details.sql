-- Every kept row gets a stable id, so a row can be corrected by id (FC-02). Rows that already exist
-- are given an id when the column is added (the default is evaluated for each existing row).
-- Correcting a row must update it in place so its id never changes.
ALTER TABLE file_rows
    ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX file_rows_id ON file_rows (id);

-- Cancelling a file discards the app's copy of the original file (FX-04), so the content can be
-- missing. Every file stored so far keeps its content; content_sha256 is kept for the record.
ALTER TABLE files
    ALTER COLUMN content DROP NOT NULL;
