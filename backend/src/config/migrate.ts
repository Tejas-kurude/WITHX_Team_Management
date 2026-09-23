import { query } from './db.js';

export async function runAutoMigrations() {
  try {
    // 1. Ensure attendance.required_work_hours exists
    await query(`
      ALTER TABLE attendance
        ADD COLUMN IF NOT EXISTS required_work_hours NUMERIC(5,2) DEFAULT 3.00;
    `);

    // Backfill historical attendance records where required_work_hours is null
    await query(`
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
    `);

    // 2. Create conversations table
    await query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_message_text TEXT,
        last_message_at TIMESTAMPTZ
      );
    `);

    // 3. Create conversation_participants table
    await query(`
      CREATE TABLE IF NOT EXISTS conversation_participants (
        id BIGSERIAL PRIMARY KEY,
        conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(conversation_id, employee_id)
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_conv_participants_emp
        ON conversation_participants(employee_id, conversation_id);
      CREATE INDEX IF NOT EXISTS idx_conv_participants_conv
        ON conversation_participants(conversation_id);
    `);

    // 4. Create messages table
    await query(`
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        message_text TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);

    await query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conv_created
        ON messages(conversation_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_messages_sender
        ON messages(sender_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_updated
        ON conversations(updated_at DESC);
    `);

    console.log('[DB] Auto-migrations and schema verifications completed successfully.');
  } catch (err) {
    console.error('[DB] Migration error (non-fatal if tables already match):', err);
  }
}
