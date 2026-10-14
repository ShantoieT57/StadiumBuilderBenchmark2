-- Who cancelled a file (FX-01..FX-06). Set together with cancelled_at when a file is cancelled. It
-- can be missing on a cancelled file only if that file was cancelled before this was recorded.
ALTER TABLE files
    ADD COLUMN cancelled_by uuid NULL REFERENCES users (id),
    ADD CONSTRAINT files_cancelled_by_only_when_cancelled CHECK (cancelled_by IS NULL OR cancelled_at IS NOT NULL);

-- Cancelling a file is recorded in its processing history as a "Cancelled" entry that starts and
-- finishes when the file is cancelled.
ALTER TABLE file_processing_stages
    DROP CONSTRAINT file_processing_stages_stage_check,
    ADD CONSTRAINT file_processing_stages_stage_check
        CHECK (stage IN ('Receive', 'DuplicateCheck', 'ReadRows', 'ConvertTypes', 'CheckRows', 'WaitForCorrections', 'Load', 'Cancelled'));
