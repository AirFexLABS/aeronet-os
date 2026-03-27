-- Migration: add vendor, os_guess, mac_address columns to devices table
-- Safe to run on both fresh and existing databases (idempotent).

ALTER TABLE devices ADD COLUMN IF NOT EXISTS mac_address VARCHAR(17);
ALTER TABLE devices ADD COLUMN IF NOT EXISTS vendor     VARCHAR(128) NOT NULL DEFAULT 'unknown';
ALTER TABLE devices ADD COLUMN IF NOT EXISTS os_guess   VARCHAR(255) NOT NULL DEFAULT 'unknown';
