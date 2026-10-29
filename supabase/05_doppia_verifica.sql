-- =====================================================================
-- Aggiornamento sicurezza: doppia verifica obbligatoria per
-- amministratore e direzione, controllata DENTRO il database.
-- Senza il codice dal telefono, anche con la password giusta,
-- admin e direzione non vedono e non toccano nessun dato.
-- Da eseguire una volta nel SQL Editor di Supabase.
-- =====================================================================

-- ognuno può sempre leggere il proprio profilo (serve per la pagina di verifica)
drop policy if exists profili_se_stesso on profili;
create policy profili_se_stesso on profili for select using (id = auth.uid());

create or replace function mio_ruolo() returns ruolo_utente
language sql stable security definer set search_path = public as $$
  select ruolo from profili
  where id = auth.uid()
    and attivo
    and (ruolo not in ('admin', 'direzione')
         or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2')
$$;

-- ha_permesso legge i permessi solo se il ruolo è valido (anche lato verifica)
create or replace function ha_permesso(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or (
    mio_ruolo() is not null and coalesce(
      (select (permessi->>p)::boolean from profili where id = auth.uid()),
      false))
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
