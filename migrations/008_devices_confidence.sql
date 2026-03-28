-- 008: Add confidence score column to devices table
ALTER TABLE devices ADD COLUMN IF NOT EXISTS confidence INTEGER DEFAULT 0;
