/*
# Add website column to suppliers

## Overview
Adds a `website` column to store the supplier's site URL separately from notes.
Existing rows that have a URL in `notes` are migrated: the URL moves to `website`
and `notes` is cleared for those rows.

## Changes
1. `suppliers.website` (text, nullable) — supplier site URL.
2. Data migration: for rows where notes contains a URL (http/https), copy it to
   website and set notes to NULL.
*/

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS website text;

-- Migrate existing URL-only notes to website, then clear those notes
UPDATE suppliers
SET website = notes, notes = NULL
WHERE notes ~* '^https?://' AND website IS NULL;
