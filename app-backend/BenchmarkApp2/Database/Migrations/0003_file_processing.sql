-- received_order numbers files in the exact order they were received, so "earlier file" (FP-01)
-- and "oldest first" never depend on two uploads having different timestamps.
-- Processing outcome of a file. row_count is set by the Receive stage. A Failed file records why
-- in failure_kind (Duplicate: final, FS-01; InvalidRows: waiting for corrections, FS-02) and a
-- message in failure_reason. A Completed file records how its rows were handled (FP-07); the three
-- counts always add up to row_count. last_processed_at is when processing last finished.
-- cancelled_at is set when a file is cancelled (FX-01..FX-06); a cancelled file never counts in
-- the duplicate check (FP-01).
ALTER TABLE files
    ADD COLUMN received_order                bigint      GENERATED ALWAYS AS IDENTITY,
    ADD COLUMN row_count                     integer     NULL CHECK (row_count >= 0),
    ADD COLUMN failure_kind                  text        NULL CHECK (failure_kind IN ('Duplicate', 'InvalidRows')),
    ADD COLUMN failure_reason                text        NULL,
    ADD COLUMN loaded_count                  integer     NULL CHECK (loaded_count >= 0),
    ADD COLUMN skipped_existing_count        integer     NULL CHECK (skipped_existing_count >= 0),
    ADD COLUMN ignored_empty_reference_count integer     NULL CHECK (ignored_empty_reference_count >= 0),
    ADD COLUMN last_processed_at             timestamptz NULL,
    ADD COLUMN cancelled_at                  timestamptz NULL,
    ADD CONSTRAINT files_failure_kind_only_when_failed CHECK ((status = 'Failed') = (failure_kind IS NOT NULL));

-- The files waiting to be processed, in the order they were received.
DROP INDEX files_awaiting_processing;
CREATE INDEX files_awaiting_processing ON files (received_order) WHERE status = 'Uploaded' AND cancelled_at IS NULL;

-- Files that are being processed, so interrupted processing can be recovered on start.
CREATE INDEX files_processing ON files (id) WHERE status = 'Processing';

-- Wakes the file processor as soon as an upload is committed.
CREATE FUNCTION notify_file_uploaded() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('file_uploaded', NEW.id::text);
    RETURN NULL;
END;
$$;

CREATE TRIGGER files_notify_uploaded
    AFTER INSERT ON files
    FOR EACH ROW
    WHEN (NEW.status = 'Uploaded')
    EXECUTE FUNCTION notify_file_uploaded();

-- The processing history of each file (FD-04): one row per stage, in the order the stages ran.
-- A stage that is still under way (Wait for corrections) has no finish time yet.
CREATE TABLE file_processing_stages (
    id          bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    file_id     uuid        NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    stage       text        NOT NULL CHECK (stage IN ('Receive', 'DuplicateCheck', 'ReadRows', 'ConvertTypes', 'CheckRows', 'WaitForCorrections', 'Load')),
    started_at  timestamptz NOT NULL,
    finished_at timestamptz NULL
);

CREATE INDEX file_processing_stages_file_id ON file_processing_stages (file_id, id);

-- The rows of a file that is waiting for corrections (FC-01..FC-03). Every row is kept, valid,
-- invalid and ignored alike, with its original column values exactly as read from the file, so a
-- re-check can repeat stages 4 to 7 over the corrected values. row_number counts transaction rows
-- from 1, not counting the header. column_count is how many columns the row had in the file;
-- values beyond the seven expected columns are kept in extra_values. reasons lists every row rule
-- the row breaks (FP-04) and is empty for a valid or ignored row.
CREATE TABLE file_rows (
    file_id          uuid    NOT NULL REFERENCES files (id) ON DELETE CASCADE,
    row_number       integer NOT NULL CHECK (row_number >= 1),
    reference        text    NOT NULL,
    transaction_date text    NOT NULL,
    account_number   text    NOT NULL,
    description      text    NOT NULL,
    amount           text    NOT NULL,
    transaction_type text    NOT NULL,
    currency         text    NOT NULL,
    column_count     integer NOT NULL,
    extra_values     text[]  NOT NULL DEFAULT '{}',
    reasons          text[]  NOT NULL DEFAULT '{}',
    PRIMARY KEY (file_id, row_number)
);

-- The invalid rows of a file, for the correction screen.
CREATE INDEX file_rows_invalid ON file_rows (file_id, row_number) WHERE cardinality(reasons) > 0;

-- One row per loaded transaction. transaction_date is the date and time exactly as written in the
-- file, which carries no time zone. created_by / last_changed_by hold "System" for a loaded
-- transaction (FP-08) or the name of the person who last changed it.
CREATE TABLE transactions (
    id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
    file_id          uuid          NOT NULL REFERENCES files (id),
    reference        text          NOT NULL,
    transaction_date timestamp     NOT NULL,
    account_number   text          NOT NULL,
    description      text          NOT NULL,
    amount           numeric(18,2) NOT NULL CHECK (amount >= 0),
    transaction_type text          NOT NULL CHECK (transaction_type IN ('Credit', 'Debit')),
    currency         text          NOT NULL,
    status           text          NOT NULL CHECK (status IN ('Imported', 'Approved', 'Rejected')),
    rejection_reason text          NULL,
    created_by       text          NOT NULL,
    created_at       timestamptz   NOT NULL,
    last_changed_by  text          NOT NULL,
    last_changed_at  timestamptz   NOT NULL
);

-- References are unique across the whole app, ignoring upper and lower case (FP-05).
CREATE UNIQUE INDEX transactions_reference_unique ON transactions (lower(reference));

CREATE INDEX transactions_file_id ON transactions (file_id);
