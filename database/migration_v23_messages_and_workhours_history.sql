-- WITHX Management Platform Migration v23
-- 1. Snapshot required_work_hours on attendance table to preserve historical integrity.
-- 2. Create tables for Messages feature (conversations, conversation_participants, messages).

BEGIN;

-- 1. Add required_work_hours to attendance table if not already present.
ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS required_work_hours NUMERIC(5,2);

-- Backfill existing attendance records using daily performance records, date overrides, or work hours settings.
UPDATE attendance a
SET required_work_hours = COALESCE(
  (
    SELECT pad.required_minutes / 60.0
    FROM performance_attendance_daily pad
    WHERE pad.employee_id = a.employee_id
      AND pad.work_date = a.work_date
    LIMIT 1
  ),
  (
    SELECT dwh.hours
    FROM work_hours_date_overrides dwh
    WHERE dwh.effective_date = a.work_date
      AND (
        (dwh.scope = 'EMPLOYEE' AND dwh.scope_id = a.employee_id) OR
        (dwh.scope = 'DEFAULT')
      )
    ORDER BY CASE WHEN dwh.scope = 'EMPLOYEE' THEN 1 ELSE 2 END
    LIMIT 1
  ),
  (
    SELECT wh.hours
    FROM work_hours_settings wh
    WHERE wh.scope = 'EMPLOYEE' AND wh.scope_id = a.employee_id
    ORDER BY wh.updated_at DESC, wh.id DESC
    LIMIT 1
  ),
  (
    SELECT wh.hours
    FROM work_hours_settings wh
    WHERE wh.scope = 'DEFAULT'
    ORDER BY wh.updated_at DESC, wh.id DESC
    LIMIT 1
  ),
  3.00
)
WHERE a.required_work_hours IS NULL;

-- Set default for new rows
ALTER TABLE attendance
  ALTER COLUMN required_work_hours SET DEFAULT 3.00;


-- 2. Conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_text TEXT,
  last_message_at TIMESTAMPTZ
);

-- 3. Conversation participants table
CREATE TABLE IF NOT EXISTS conversation_participants (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_conv_participants_emp
  ON conversation_participants(employee_id, conversation_id);

CREATE INDEX IF NOT EXISTS idx_conv_participants_conv
  ON conversation_participants(conversation_id);

-- 4. Messages table
CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  message_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_conv_created
  ON messages(conversation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_messages_sender
  ON messages(sender_id);

CREATE INDEX IF NOT EXISTS idx_conversations_updated
  ON conversations(updated_at DESC);

COMMIT;
