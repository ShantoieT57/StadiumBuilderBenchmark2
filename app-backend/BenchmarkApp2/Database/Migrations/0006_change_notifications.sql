-- Live change notifications for the event stream (GET /events). Every change the front-end shows
-- is announced on the 'change_events' channel as {"type": ..., "data": {...}}. pg_notify is
-- transactional: a notification is delivered only when, and once, its transaction commits, and a
-- rolled-back change is never announced. Within one transaction, identical notifications are
-- delivered once, so a change announced both by a trigger and explicitly is announced once.

-- Announces a file with its current status and whether it is cancelled. Used by the files triggers
-- and called explicitly when a file is checked again, since a re-check that still finds invalid
-- rows can leave every column the triggers watch unchanged.
CREATE FUNCTION announce_file_changed(changed_file_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify('change_events', json_build_object(
                'type', 'file-changed',
                'data', json_build_object('fileId', f.id, 'status', f.status, 'isCancelled', f.cancelled_at IS NOT NULL))::text)
    FROM files f
    WHERE f.id = changed_file_id;
END;
$$;

CREATE FUNCTION notify_file_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM announce_file_changed(NEW.id);
    RETURN NULL;
END;
$$;

-- An upload.
CREATE TRIGGER files_notify_inserted
    AFTER INSERT ON files
    FOR EACH ROW
    EXECUTE FUNCTION notify_file_changed();

-- A status change, a finished processing run or re-check, or a cancel.
CREATE TRIGGER files_notify_changed
    AFTER UPDATE ON files
    FOR EACH ROW
    WHEN (OLD.status IS DISTINCT FROM NEW.status
          OR OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at
          OR OLD.last_processed_at IS DISTINCT FROM NEW.last_processed_at)
    EXECUTE FUNCTION notify_file_changed();

-- Announces, once per statement, each file whose transactions were loaded, approved, rejected or
-- removed. The transition table is new_rows for inserts and updates, and old_rows for deletes.
CREATE FUNCTION notify_transactions_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM pg_notify('change_events', json_build_object('type', 'transactions-changed', 'data', json_build_object('fileId', file_id))::text)
        FROM (SELECT DISTINCT file_id FROM old_rows) AS changed;
    ELSE
        PERFORM pg_notify('change_events', json_build_object('type', 'transactions-changed', 'data', json_build_object('fileId', file_id))::text)
        FROM (SELECT DISTINCT file_id FROM new_rows) AS changed;
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER transactions_notify_inserted
    AFTER INSERT ON transactions
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION notify_transactions_changed();

CREATE TRIGGER transactions_notify_updated
    AFTER UPDATE ON transactions
    REFERENCING NEW TABLE AS new_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION notify_transactions_changed();

CREATE TRIGGER transactions_notify_deleted
    AFTER DELETE ON transactions
    REFERENCING OLD TABLE AS old_rows
    FOR EACH STATEMENT
    EXECUTE FUNCTION notify_transactions_changed();
