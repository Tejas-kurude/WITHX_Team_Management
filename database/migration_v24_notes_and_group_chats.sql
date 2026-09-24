-- WITHX Management Platform Migration v24
-- 1. Notepad: Personal Notes System (notes table)
-- 2. Messages: Group Chat Support (conversations is_group, name, created_by)

BEGIN;

-- 1. Create notes table
CREATE TABLE IF NOT EXISTS notes (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL DEFAULT 'Untitled Note',
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notes_user_updated
  ON notes(user_id, updated_at DESC);

-- 2. Extend conversations table for group messaging
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS created_by INT REFERENCES employees(id) ON DELETE SET NULL;

COMMIT;
