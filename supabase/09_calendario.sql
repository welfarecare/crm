-- =====================================================================
-- Tappa 2: collegamento Google Calendar (link Meet sugli appuntamenti)
-- Da eseguire una volta nel SQL Editor di Supabase.
-- =====================================================================
alter table appuntamenti add column if not exists meet_link text;
