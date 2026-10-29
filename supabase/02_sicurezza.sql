-- =====================================================================
-- Sicurezza: ognuno vede solo le campagne assegnate (regole per riga)
-- =====================================================================

create or replace function mio_ruolo() returns ruolo_utente
language sql stable security definer set search_path = public as $$
  select ruolo from profili where id = auth.uid() and attivo
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(mio_ruolo() = 'admin', false)
$$;

-- admin e direzione vedono tutto (la direzione in sola lettura)
create or replace function vede_tutto() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(mio_ruolo() in ('admin', 'direzione'), false)
$$;

-- chi può scrivere dati operativi (la direzione no)
create or replace function puo_scrivere() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(mio_ruolo() in ('admin', 'operatore'), false)
$$;

create or replace function ha_permesso(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or coalesce(
    (select (permessi->>p)::boolean from profili where id = auth.uid() and attivo),
    false)
$$;

create or replace function vede_campagna(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select vede_tutto() or (
    mio_ruolo() is not null and exists (
      select 1 from campagne_assegnazioni
      where campagna_id = cid and utente_id = auth.uid()))
$$;

create or replace function vede_azienda(aid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select vede_tutto() or (
    mio_ruolo() is not null and (
      exists (
        select 1 from campagna_aziende ca
        join campagne_assegnazioni ass on ass.campagna_id = ca.campagna_id
        where ca.azienda_id = aid and ass.utente_id = auth.uid())
      or exists (
        select 1 from appuntamenti a
        where a.azienda_id = aid and a.incaricato_id = auth.uid())))
$$;

alter table profili enable row level security;
alter table fonti_liste enable row level security;
alter table aziende enable row level security;
alter table referenti enable row level security;
alter table modifiche_aziende enable row level security;
alter table campagne enable row level security;
alter table campagne_assegnazioni enable row level security;
alter table campagna_aziende enable row level security;
alter table chiamate enable row level security;
alter table appuntamenti enable row level security;
alter table registro_attivita enable row level security;

-- profili: tutti gli utenti attivi vedono nomi e ruoli; solo l'admin modifica
create policy profili_lettura on profili for select using (mio_ruolo() is not null);
create policy profili_admin on profili for all using (is_admin()) with check (is_admin());

create policy fonti_lettura on fonti_liste for select using (mio_ruolo() is not null);

create policy aziende_lettura on aziende for select using (vede_azienda(id));
create policy aziende_modifica on aziende for update
  using (puo_scrivere() and vede_azienda(id)) with check (puo_scrivere() and vede_azienda(id));
create policy aziende_admin on aziende for all using (is_admin()) with check (is_admin());

create policy referenti_lettura on referenti for select using (vede_azienda(azienda_id));
create policy referenti_scrittura on referenti for all
  using (puo_scrivere() and vede_azienda(azienda_id))
  with check (puo_scrivere() and vede_azienda(azienda_id));

create policy modifiche_lettura on modifiche_aziende for select using (vede_azienda(azienda_id));

create policy campagne_lettura on campagne for select using (vede_campagna(id));
create policy campagne_crea on campagne for insert with check (ha_permesso('creare_campagne'));
create policy campagne_modifica on campagne for update
  using (ha_permesso('creare_campagne') and vede_campagna(id))
  with check (ha_permesso('creare_campagne'));
create policy campagne_elimina on campagne for delete using (is_admin());

create policy assegnazioni_lettura on campagne_assegnazioni for select
  using (is_admin() or utente_id = auth.uid());
create policy assegnazioni_admin on campagne_assegnazioni for all
  using (is_admin()) with check (is_admin());

create policy ca_lettura on campagna_aziende for select using (vede_campagna(campagna_id));
create policy ca_modifica on campagna_aziende for update
  using (puo_scrivere() and vede_campagna(campagna_id))
  with check (puo_scrivere() and vede_campagna(campagna_id));
create policy ca_gestione on campagna_aziende for delete
  using (ha_permesso('creare_campagne') and vede_campagna(campagna_id));

create policy chiamate_lettura on chiamate for select using (vede_campagna(campagna_id));

create policy app_lettura on appuntamenti for select
  using (vede_campagna(campagna_id) or (mio_ruolo() is not null and incaricato_id = auth.uid()));
create policy app_modifica on appuntamenti for update
  using (puo_scrivere() and vede_campagna(campagna_id))
  with check (puo_scrivere() and vede_campagna(campagna_id));

create policy registro_lettura on registro_attivita for select using (is_admin());

-- Le scritture complesse (chiamate, import, composizione liste, appuntamenti)
-- passano solo dalle funzioni in 03_funzioni.sql, che controllano i permessi.
