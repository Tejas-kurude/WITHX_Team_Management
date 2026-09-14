-- WITHX task drafts migration
-- Adds DRAFT as a valid task status without changing existing rows.
DO $$
DECLARE
  c_name text;
BEGIN
  SELECT conname
  INTO c_name
  FROM pg_constraint
  WHERE conrelid = 'tasks'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%'
    AND pg_get_constraintdef(oid) ILIKE '%PENDING%'
    AND pg_get_constraintdef(oid) ILIKE '%COMPLETED%'
  ORDER BY conname
  LIMIT 1;

  IF c_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE tasks DROP CONSTRAINT %I', c_name);
  END IF;
END $$;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_status_check
  CHECK (
    status IN (
      'DRAFT','PENDING','IN_PROGRESS','COMPLETED','BLOCKED',
      'CANCELLED','SUBMITTED','NEEDS_CHANGES','REJECTED'
    )
  );
