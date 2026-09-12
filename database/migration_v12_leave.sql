-- Existing database migration for the Leave changes.
-- Keeps existing historical leave rows intact while restricting all new
-- inserts/updates to the three supported leave types.

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS reference_link TEXT;

ALTER TABLE leave_requests
  DROP CONSTRAINT IF EXISTS leave_requests_leave_type_check;

ALTER TABLE leave_requests
  ADD CONSTRAINT leave_requests_leave_type_check
  CHECK (leave_type IN ('PAID','SICK','UNPAID'))
  NOT VALID;
