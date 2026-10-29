-- WelfareCare · CRM Telemarketing — installazione completa (tappa 1)
-- Incolla tutto nel SQL Editor di Supabase ed esegui UNA volta.

-- =====================================================================
-- WelfareCare · CRM Telemarketing — schema database (tappa 1)
-- Da eseguire UNA volta nel SQL Editor di Supabase, su un progetto nuovo.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------
-- Tipi
-- ---------------------------------------------------------------------
create type ruolo_utente as enum ('admin', 'direzione', 'operatore', 'incaricato');
create type stato_campagna as enum ('preparazione', 'in_corso', 'chiusa');
create type stato_azienda as enum ('sconosciuto', 'attiva', 'chiusa', 'numero_errato');
create type stato_in_campagna as enum ('da_chiamare', 'richiamare', 'appuntamento', 'chiusa_negativa', 'esclusa');
create type esito_chiamata as enum (
  'appuntamento', 'richiamare', 'non_risponde', 'occupato', 'segreteria',
  'mail_inviata', 'non_interessato', 'referente_cambiato', 'numero_errato',
  'azienda_chiusa', 'gia_cliente', 'da_non_chiamare'
);
create type esito_incontro as enum ('svolto', 'rimandato', 'non_svolto');
create type esito_contratto as enum ('firmato', 'in_trattativa', 'no');

-- ---------------------------------------------------------------------
-- Funzioni di normalizzazione (per doppioni e ricerche)
-- ---------------------------------------------------------------------
create or replace function norm_tel(t text) returns text
language plpgsql immutable as $$
declare d text;
begin
  if t is null then return null; end if;
  d := regexp_replace(t, '\D', '', 'g');
  if d like '0039%' then d := substr(d, 5);
  elsif t ~ '^\s*\+39' then d := substr(d, 3);
  end if;
  return nullif(d, '');
end $$;

create or replace function norm_piva(t text) returns text
language plpgsql immutable as $$
declare d text;
begin
  if t is null then return null; end if;
  d := regexp_replace(t, '\D', '', 'g');
  if d = '' then return null; end if;
  -- Excel spesso perde gli zeri iniziali della P.IVA
  if length(d) < 11 then d := lpad(d, 11, '0'); end if;
  return d;
end $$;

create or replace function norm_testo(t text) returns text
language sql immutable as $$
  select nullif(lower(trim(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g'))), '')
$$;

-- ---------------------------------------------------------------------
-- Utenti
-- ---------------------------------------------------------------------
create table profili (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nome text not null default '',
  ruolo ruolo_utente not null default 'operatore',
  attivo boolean not null default true,
  -- funzioni sbloccabili dal Centro di controllo
  permessi jsonb not null default '{"importare":false,"creare_campagne":false,"gemini_lanciare":false,"gemini_approvare":false,"report":false,"esportare":false}'::jsonb,
  zona text,
  created_at timestamptz not null default now()
);

-- Crea il profilo quando l'amministratore crea un utente
create or replace function crea_profilo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profili (id, email, nome, ruolo)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'nome', ''),
    coalesce((new.raw_user_meta_data->>'ruolo')::ruolo_utente, 'operatore')
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function crea_profilo();

-- ---------------------------------------------------------------------
-- Aziende e referenti
-- ---------------------------------------------------------------------
create table fonti_liste (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  righe_importate int not null default 0,
  created_by uuid references profili(id),
  created_at timestamptz not null default now()
);

create table aziende (
  id uuid primary key default gen_random_uuid(),
  ragione_sociale text not null,
  piva text,
  piva_norm text generated always as (norm_piva(piva)) stored,
  telefono text,
  telefono_norm text generated always as (norm_tel(telefono)) stored,
  email text,
  sito text,
  indirizzo text,
  comune text,
  comune_norm text generated always as (norm_testo(comune)) stored,
  provincia text,
  cap text,
  settore text,
  dipendenti int,
  stato stato_azienda not null default 'sconosciuto',
  non_chiamare boolean not null default false,
  non_chiamare_motivo text,
  note text,
  fonte_id uuid references fonti_liste(id),
  verificata_at timestamptz,
  created_by uuid references profili(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index aziende_piva_unica on aziende (piva_norm) where piva_norm is not null;
create index aziende_tel on aziende (telefono_norm);
create index aziende_comune on aziende (comune_norm);
create index aziende_nome_trgm on aziende using gin (ragione_sociale extensions.gin_trgm_ops);

create table referenti (
  id uuid primary key default gen_random_uuid(),
  azienda_id uuid not null references aziende(id) on delete cascade,
  nome text not null,
  ruolo text,
  telefono text,
  email text,
  note text,
  attivo boolean not null default true,
  created_at timestamptz not null default now()
);
create index referenti_azienda on referenti (azienda_id);

-- Cronologia delle modifiche ai dati azienda
create table modifiche_aziende (
  id bigserial primary key,
  azienda_id uuid not null references aziende(id) on delete cascade,
  campo text not null,
  valore_vecchio text,
  valore_nuovo text,
  fonte text not null default 'manuale', -- manuale | import | chiamata | gemini
  utente_id uuid references profili(id),
  created_at timestamptz not null default now()
);
create index modifiche_azienda on modifiche_aziende (azienda_id, created_at desc);

create or replace function traccia_modifiche_azienda() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  campo text;
  vecchio text;
  nuovo text;
  fonte text := coalesce(nullif(current_setting('app.fonte', true), ''), 'manuale');
begin
  new.updated_at := now();
  foreach campo in array array['ragione_sociale','piva','telefono','email','sito','indirizzo','comune','provincia','cap','settore','dipendenti','stato','non_chiamare'] loop
    execute format('select ($1).%I::text, ($2).%I::text', campo, campo) into vecchio, nuovo using old, new;
    if vecchio is distinct from nuovo then
      insert into modifiche_aziende (azienda_id, campo, valore_vecchio, valore_nuovo, fonte, utente_id)
      values (new.id, campo, vecchio, nuovo, fonte, auth.uid());
    end if;
  end loop;
  return new;
end $$;

create trigger aziende_modifiche
  before update on aziende
  for each row execute function traccia_modifiche_azienda();

-- ---------------------------------------------------------------------
-- Campagne (una per comune ed edizione)
-- ---------------------------------------------------------------------
create table campagne (
  id uuid primary key default gen_random_uuid(),
  comune text not null,
  edizione text not null,
  stato stato_campagna not null default 'preparazione',
  note text,
  created_by uuid references profili(id),
  created_at timestamptz not null default now(),
  unique (comune, edizione)
);

create table campagne_assegnazioni (
  campagna_id uuid not null references campagne(id) on delete cascade,
  utente_id uuid not null references profili(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (campagna_id, utente_id)
);
create index assegnazioni_utente on campagne_assegnazioni (utente_id);

create table campagna_aziende (
  id uuid primary key default gen_random_uuid(),
  campagna_id uuid not null references campagne(id) on delete cascade,
  azienda_id uuid not null references aziende(id) on delete cascade,
  stato stato_in_campagna not null default 'da_chiamare',
  prossimo_richiamo timestamptz,
  tentativi int not null default 0,
  ultimo_esito esito_chiamata,
  ultimo_contatto_at timestamptz,
  bloccata_da uuid references profili(id),
  bloccata_at timestamptz,
  aggiunta_da uuid references profili(id),
  created_at timestamptz not null default now(),
  unique (campagna_id, azienda_id)
);
create index ca_coda on campagna_aziende (campagna_id, stato, prossimo_richiamo);
create index ca_azienda on campagna_aziende (azienda_id);

-- ---------------------------------------------------------------------
-- Chiamate e appuntamenti
-- ---------------------------------------------------------------------
create table chiamate (
  id uuid primary key default gen_random_uuid(),
  campagna_azienda_id uuid not null references campagna_aziende(id) on delete cascade,
  campagna_id uuid not null references campagne(id) on delete cascade,
  azienda_id uuid not null references aziende(id) on delete cascade,
  operatore_id uuid not null references profili(id),
  esito esito_chiamata not null,
  motivo text,
  note text,
  richiamo_at timestamptz,
  created_at timestamptz not null default now()
);
create index chiamate_azienda on chiamate (azienda_id, created_at desc);
create index chiamate_campagna on chiamate (campagna_id, created_at desc);
create index chiamate_operatore on chiamate (operatore_id, created_at desc);

create table appuntamenti (
  id uuid primary key default gen_random_uuid(),
  campagna_id uuid not null references campagne(id) on delete cascade,
  azienda_id uuid not null references aziende(id) on delete cascade,
  chiamata_id uuid references chiamate(id) on delete set null,
  incaricato_id uuid not null references profili(id),
  operatore_id uuid not null references profili(id),
  inizio timestamptz not null,
  fine timestamptz not null,
  modalita text not null default 'presenza', -- presenza | video
  referente_id uuid references referenti(id) on delete set null,
  note text,
  esito_incontro esito_incontro,
  esito_contratto esito_contratto,
  esito_note text,
  esito_at timestamptz,
  google_event_id text, -- tappa 2
  annullato boolean not null default false,
  created_at timestamptz not null default now(),
  check (fine > inizio)
);
create index app_incaricato on appuntamenti (incaricato_id, inizio);
create index app_azienda on appuntamenti (azienda_id);
create index app_campagna on appuntamenti (campagna_id, inizio);

-- ---------------------------------------------------------------------
-- Registro attività (Centro di controllo)
-- ---------------------------------------------------------------------
create table registro_attivita (
  id bigserial primary key,
  utente_id uuid references profili(id),
  azione text not null,
  created_at timestamptz not null default now()
);
create index registro_data on registro_attivita (created_at desc);

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

-- =====================================================================
-- Funzioni operative (controllano sempre ruolo, permessi e campagne)
-- =====================================================================

create or replace function registra_attivita(p_azione text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if mio_ruolo() is null then raise exception 'Non autorizzato'; end if;
  insert into registro_attivita (utente_id, azione) values (auth.uid(), p_azione);
end $$;

-- ---------------------------------------------------------------------
-- Coda chiamate
-- ---------------------------------------------------------------------
-- Restituisce (e blocca per 15 minuti) la prossima azienda da chiamare.
-- Ordine: richiami fissati e scaduti → aziende mai chiamate → ritentativi.
create or replace function prossima_azienda(p_campagna uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (puo_scrivere() and vede_campagna(p_campagna)) then
    raise exception 'Non autorizzato su questa campagna';
  end if;

  -- se ho già un'azienda bloccata in questa campagna, riprendo quella
  select id into v_id from campagna_aziende
  where campagna_id = p_campagna and bloccata_da = auth.uid()
    and bloccata_at > now() - interval '15 minutes'
    and stato in ('da_chiamare', 'richiamare')
  order by bloccata_at desc limit 1;
  if v_id is not null then
    update campagna_aziende set bloccata_at = now() where id = v_id;
    return v_id;
  end if;

  select ca.id into v_id
  from campagna_aziende ca
  join aziende a on a.id = ca.azienda_id
  where ca.campagna_id = p_campagna
    and ca.stato in ('da_chiamare', 'richiamare')
    and (ca.prossimo_richiamo is null or ca.prossimo_richiamo <= now())
    and (ca.bloccata_da is null or ca.bloccata_at < now() - interval '15 minutes')
    and not a.non_chiamare
    and a.stato not in ('chiusa', 'numero_errato')
  order by (ca.stato = 'richiamare') desc,
           ca.prossimo_richiamo asc nulls last,
           ca.tentativi asc,
           ca.ultimo_contatto_at asc nulls first
  limit 1
  for update of ca skip locked;

  if v_id is not null then
    update campagna_aziende set bloccata_da = auth.uid(), bloccata_at = now() where id = v_id;
  end if;
  return v_id;
end $$;

-- "Salta": rilascia l'azienda e la rimanda di un'ora
create or replace function salta_azienda(p_ca uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_campagna uuid;
begin
  select campagna_id into v_campagna from campagna_aziende where id = p_ca;
  if v_campagna is null or not (puo_scrivere() and vede_campagna(v_campagna)) then
    raise exception 'Non autorizzato';
  end if;
  update campagna_aziende
  set bloccata_da = null, bloccata_at = null,
      prossimo_richiamo = greatest(coalesce(prossimo_richiamo, now()), now() + interval '1 hour')
  where id = p_ca;
end $$;

-- Prossime aziende in coda (anteprima, senza bloccarle)
create or replace function anteprima_coda(p_campagna uuid, p_limite int default 5)
returns table (azienda_id uuid, ragione_sociale text, stato stato_in_campagna,
               tentativi int, prossimo_richiamo timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not vede_campagna(p_campagna) then raise exception 'Non autorizzato'; end if;
  return query
  select a.id, a.ragione_sociale, ca.stato, ca.tentativi, ca.prossimo_richiamo
  from campagna_aziende ca join aziende a on a.id = ca.azienda_id
  where ca.campagna_id = p_campagna
    and ca.stato in ('da_chiamare', 'richiamare')
    and (ca.bloccata_da is null or ca.bloccata_at < now() - interval '15 minutes')
    and not a.non_chiamare and a.stato not in ('chiusa', 'numero_errato')
  order by (ca.prossimo_richiamo is null or ca.prossimo_richiamo <= now()) desc,
           (ca.stato = 'richiamare') desc,
           ca.prossimo_richiamo asc nulls last,
           ca.tentativi asc,
           ca.ultimo_contatto_at asc nulls first
  limit p_limite;
end $$;

-- Numeri in testa alla coda
create or replace function stato_coda(p_campagna uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not vede_campagna(p_campagna) then raise exception 'Non autorizzato'; end if;
  select jsonb_build_object(
    'totale', (select count(*) from campagna_aziende where campagna_id = p_campagna),
    'lavorate', (select count(*) from campagna_aziende where campagna_id = p_campagna
                 and (tentativi > 0 or stato <> 'da_chiamare')),
    'chiamate_oggi', (select count(*) from chiamate where campagna_id = p_campagna
                      and operatore_id = auth.uid()
                      and created_at >= date_trunc('day', now() at time zone 'Europe/Rome') at time zone 'Europe/Rome'),
    'appuntamenti_oggi', (select count(*) from appuntamenti where campagna_id = p_campagna
                          and operatore_id = auth.uid()
                          and created_at >= date_trunc('day', now() at time zone 'Europe/Rome') at time zone 'Europe/Rome')
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- Registrazione esito chiamata (+ eventuale appuntamento)
-- p_app: {"incaricato_id","inizio","fine","modalita","referente_id","note"}
-- ---------------------------------------------------------------------
create or replace function registra_chiamata(
  p_ca uuid,
  p_esito esito_chiamata,
  p_note text default null,
  p_motivo text default null,
  p_richiamo timestamptz default null,
  p_app jsonb default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ca campagna_aziende%rowtype;
  v_chiamata uuid;
  v_stato stato_in_campagna;
  v_richiamo timestamptz := null;
  v_tentativi int;
  v_inc uuid;
  v_inizio timestamptz;
  v_fine timestamptz;
  max_tentativi constant int := 6;
begin
  select * into v_ca from campagna_aziende where id = p_ca for update;
  if v_ca.id is null or not (puo_scrivere() and vede_campagna(v_ca.campagna_id)) then
    raise exception 'Non autorizzato';
  end if;

  v_tentativi := v_ca.tentativi + 1;

  case p_esito
    when 'non_risponde', 'occupato', 'segreteria' then
      if v_tentativi >= max_tentativi then
        v_stato := 'chiusa_negativa';
      else
        v_stato := 'da_chiamare';
        -- ritenta non prima di 3 ore (occupato: 30 minuti)
        v_richiamo := now() + case when p_esito = 'occupato' then interval '30 minutes' else interval '3 hours' end;
      end if;
    when 'richiamare' then
      if p_richiamo is null then raise exception 'Indica quando richiamare'; end if;
      v_stato := 'richiamare'; v_richiamo := p_richiamo;
    when 'mail_inviata' then
      v_stato := 'richiamare'; v_richiamo := coalesce(p_richiamo, now() + interval '7 days');
    when 'referente_cambiato' then
      if p_richiamo is not null then v_stato := 'richiamare'; v_richiamo := p_richiamo;
      else v_stato := 'da_chiamare'; end if;
    when 'non_interessato', 'numero_errato', 'azienda_chiusa' then
      v_stato := 'chiusa_negativa';
    when 'gia_cliente', 'da_non_chiamare' then
      v_stato := 'esclusa';
    when 'appuntamento' then
      v_stato := 'appuntamento';
  end case;

  insert into chiamate (campagna_azienda_id, campagna_id, azienda_id, operatore_id, esito, motivo, note, richiamo_at)
  values (p_ca, v_ca.campagna_id, v_ca.azienda_id, auth.uid(), p_esito, nullif(p_motivo, ''), nullif(p_note, ''), v_richiamo)
  returning id into v_chiamata;

  update campagna_aziende set
    stato = v_stato,
    prossimo_richiamo = v_richiamo,
    tentativi = v_tentativi,
    ultimo_esito = p_esito,
    ultimo_contatto_at = now(),
    bloccata_da = null, bloccata_at = null
  where id = p_ca;

  -- effetti sull'anagrafica (restano per le prossime edizioni)
  perform set_config('app.fonte', 'chiamata', true);
  if p_esito = 'numero_errato' then
    update aziende set stato = 'numero_errato' where id = v_ca.azienda_id;
  elsif p_esito = 'azienda_chiusa' then
    update aziende set stato = 'chiusa' where id = v_ca.azienda_id;
  elsif p_esito = 'da_non_chiamare' then
    update aziende set non_chiamare = true,
      non_chiamare_motivo = coalesce(nullif(p_note, ''), 'Richiesta durante la chiamata')
    where id = v_ca.azienda_id;
  elsif p_esito in ('appuntamento', 'non_interessato', 'richiamare', 'mail_inviata', 'gia_cliente', 'referente_cambiato') then
    update aziende set stato = 'attiva' where id = v_ca.azienda_id and stato = 'sconosciuto';
  end if;

  if p_esito = 'appuntamento' then
    if p_app is null then raise exception 'Mancano i dati dell''appuntamento'; end if;
    v_inc := (p_app->>'incaricato_id')::uuid;
    v_inizio := (p_app->>'inizio')::timestamptz;
    v_fine := coalesce((p_app->>'fine')::timestamptz, v_inizio + interval '1 hour');
    if not exists (select 1 from profili where id = v_inc and ruolo = 'incaricato' and attivo) then
      raise exception 'Incaricato non valido';
    end if;
    if exists (select 1 from appuntamenti where incaricato_id = v_inc and not annullato
               and tstzrange(inizio, fine) && tstzrange(v_inizio, v_fine)) then
      raise exception 'L''incaricato ha già un appuntamento in quell''orario';
    end if;
    insert into appuntamenti (campagna_id, azienda_id, chiamata_id, incaricato_id, operatore_id,
                              inizio, fine, modalita, referente_id, note)
    values (v_ca.campagna_id, v_ca.azienda_id, v_chiamata, v_inc, auth.uid(),
            v_inizio, v_fine, coalesce(p_app->>'modalita', 'presenza'),
            nullif(p_app->>'referente_id', '')::uuid, nullif(p_app->>'note', ''));
  end if;

  return v_chiamata;
end $$;

-- Impegni di un incaricato in un giorno (solo orari, senza dettagli)
create or replace function impegni_incaricato(p_incaricato uuid, p_giorno date)
returns table (inizio timestamptz, fine timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not puo_scrivere() then raise exception 'Non autorizzato'; end if;
  return query
  select a.inizio, a.fine from appuntamenti a
  where a.incaricato_id = p_incaricato and not a.annullato
    and a.inizio < ((p_giorno + 1)::timestamp at time zone 'Europe/Rome')
    and a.fine > (p_giorno::timestamp at time zone 'Europe/Rome')
  order by a.inizio;
end $$;

-- Esito dell'incontro, compilato dall'incaricato (o da admin/operatore)
create or replace function salva_esito_appuntamento(
  p_app uuid,
  p_incontro esito_incontro,
  p_contratto esito_contratto default null,
  p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare v appuntamenti%rowtype;
begin
  select * into v from appuntamenti where id = p_app;
  if v.id is null then raise exception 'Appuntamento non trovato'; end if;
  if not ((mio_ruolo() = 'incaricato' and v.incaricato_id = auth.uid())
          or (puo_scrivere() and vede_campagna(v.campagna_id))) then
    raise exception 'Non autorizzato';
  end if;
  update appuntamenti set
    esito_incontro = p_incontro,
    esito_contratto = case when p_incontro = 'svolto' then p_contratto else null end,
    esito_note = nullif(p_note, ''),
    esito_at = now()
  where id = p_app;
end $$;

-- ---------------------------------------------------------------------
-- Import liste
-- ---------------------------------------------------------------------
create or replace function crea_fonte(p_nome text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not ha_permesso('importare') then raise exception 'Non hai il permesso di importare'; end if;
  insert into fonti_liste (nome, created_by) values (p_nome, auth.uid()) returning id into v;
  return v;
end $$;

-- p_righe: array di oggetti con chiavi
--   ragione_sociale, piva, telefono, email, sito, indirizzo, comune, provincia,
--   cap, settore, dipendenti, note, referente_nome, referente_ruolo,
--   referente_telefono, referente_email
-- p_anteprima = true: conta soltanto, non scrive nulla.
create or replace function importa_aziende(
  p_righe jsonb,
  p_fonte uuid,
  p_campagna uuid default null,
  p_anteprima boolean default true,
  p_includi_doppioni boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_piva text;
  v_tel text;
  v_esistente aziende%rowtype;
  v_id uuid;
  n_nuove int := 0;
  n_aggiornate int := 0;
  n_doppioni int := 0;
  n_non_chiamare int := 0;
  n_scartate int := 0;
  n_in_campagna int := 0;
  doppioni jsonb := '[]'::jsonb;
  v_ins int;
  viste_piva text[] := '{}';
  visti_tel text[] := '{}';
begin
  if not ha_permesso('importare') then raise exception 'Non hai il permesso di importare'; end if;
  if p_campagna is not null and not vede_campagna(p_campagna) then
    raise exception 'Non autorizzato su questa campagna';
  end if;
  perform set_config('app.fonte', 'import', true);

  for r in select * from jsonb_array_elements(p_righe) loop
    if nullif(trim(r->>'ragione_sociale'), '') is null then
      n_scartate := n_scartate + 1;
      continue;
    end if;

    v_piva := norm_piva(r->>'piva');
    v_tel := norm_tel(r->>'telefono');
    v_id := null;
    v_esistente := null;

    if v_piva is not null then
      select * into v_esistente from aziende where piva_norm = v_piva;
    end if;

    if v_esistente.id is not null then
      if v_esistente.non_chiamare then
        n_non_chiamare := n_non_chiamare + 1;
        continue;
      end if;
      n_aggiornate := n_aggiornate + 1;
      v_id := v_esistente.id;
      if not p_anteprima then
        -- completa solo i campi vuoti, non sovrascrive dati già verificati
        update aziende set
          telefono = coalesce(telefono, nullif(r->>'telefono', '')),
          email = coalesce(email, nullif(r->>'email', '')),
          sito = coalesce(sito, nullif(r->>'sito', '')),
          indirizzo = coalesce(indirizzo, nullif(r->>'indirizzo', '')),
          comune = coalesce(comune, nullif(r->>'comune', '')),
          provincia = coalesce(provincia, nullif(r->>'provincia', '')),
          cap = coalesce(cap, nullif(r->>'cap', '')),
          settore = coalesce(settore, nullif(r->>'settore', '')),
          dipendenti = coalesce(dipendenti, nullif(regexp_replace(coalesce(r->>'dipendenti', ''), '\D', '', 'g'), '')::int)
        where id = v_id;
      end if;
    else
      if v_tel is not null then
        select * into v_esistente from aziende where telefono_norm = v_tel limit 1;
      end if;
      if v_esistente.id is not null and v_esistente.non_chiamare then
        n_non_chiamare := n_non_chiamare + 1;
        continue;
      end if;
      -- in anteprima riconosco anche i doppioni interni al file
      if p_anteprima and v_esistente.id is null then
        if v_piva is not null and v_piva = any (viste_piva) then
          n_aggiornate := n_aggiornate + 1;
          continue;
        end if;
        if v_tel is not null and v_tel = any (visti_tel) and not p_includi_doppioni then
          n_doppioni := n_doppioni + 1;
          continue;
        end if;
        viste_piva := viste_piva || v_piva;
        visti_tel := visti_tel || v_tel;
      end if;
      if v_esistente.id is not null and not p_includi_doppioni then
        n_doppioni := n_doppioni + 1;
        if jsonb_array_length(doppioni) < 200 then
          doppioni := doppioni || jsonb_build_object(
            'nel_file', r->>'ragione_sociale',
            'telefono', r->>'telefono',
            'gia_presente', v_esistente.ragione_sociale,
            'azienda_id', v_esistente.id);
        end if;
        continue;
      end if;
      n_nuove := n_nuove + 1;
      if not p_anteprima then
        insert into aziende (ragione_sociale, piva, telefono, email, sito, indirizzo, comune,
                             provincia, cap, settore, dipendenti, note, fonte_id, created_by)
        values (trim(r->>'ragione_sociale'), nullif(r->>'piva', ''), nullif(r->>'telefono', ''),
                nullif(r->>'email', ''), nullif(r->>'sito', ''), nullif(r->>'indirizzo', ''),
                nullif(trim(r->>'comune'), ''), nullif(r->>'provincia', ''), nullif(r->>'cap', ''),
                nullif(r->>'settore', ''),
                nullif(regexp_replace(coalesce(r->>'dipendenti', ''), '\D', '', 'g'), '')::int,
                nullif(r->>'note', ''), p_fonte, auth.uid())
        on conflict (piva_norm) where piva_norm is not null do nothing
        returning id into v_id;
        if v_id is null then
          -- stessa P.IVA comparsa due volte nello stesso file
          select id into v_id from aziende where piva_norm = v_piva;
          n_nuove := n_nuove - 1;
          n_aggiornate := n_aggiornate + 1;
        elsif nullif(trim(r->>'referente_nome'), '') is not null then
          insert into referenti (azienda_id, nome, ruolo, telefono, email)
          values (v_id, trim(r->>'referente_nome'), nullif(r->>'referente_ruolo', ''),
                  nullif(r->>'referente_telefono', ''), nullif(r->>'referente_email', ''));
        end if;
      end if;
    end if;

    if p_campagna is not null then
      if p_anteprima then
        if v_id is null or not exists (select 1 from campagna_aziende where campagna_id = p_campagna and azienda_id = v_id) then
          n_in_campagna := n_in_campagna + 1;
        end if;
      elsif v_id is not null then
        insert into campagna_aziende (campagna_id, azienda_id, aggiunta_da)
        values (p_campagna, v_id, auth.uid())
        on conflict do nothing;
        get diagnostics v_ins = row_count;
        n_in_campagna := n_in_campagna + v_ins;
      end if;
    end if;
  end loop;

  if not p_anteprima and p_fonte is not null then
    update fonti_liste set righe_importate = righe_importate + n_nuove where id = p_fonte;
  end if;

  return jsonb_build_object(
    'nuove', n_nuove, 'aggiornate', n_aggiornate, 'doppioni', n_doppioni,
    'non_chiamare', n_non_chiamare, 'scartate', n_scartate,
    'in_campagna', n_in_campagna, 'elenco_doppioni', doppioni);
end $$;

-- ---------------------------------------------------------------------
-- Composizione liste di campagna
-- ---------------------------------------------------------------------
create or replace function componi_campagna(
  p_campagna uuid,
  p_comuni text[] default '{}',
  p_da_campagna uuid default null,
  p_escludi_contratti boolean default true,
  p_mesi_non_interessati int default 18,
  p_anteprima boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  n_candidate int;
  n_non_chiamare int;
  n_chiuse int;
  n_contratti int;
  n_non_interessati int;
  n_gia int;
  n_aggiunte int := 0;
begin
  if not (ha_permesso('creare_campagne') and vede_campagna(p_campagna)) then
    raise exception 'Non autorizzato';
  end if;
  if p_da_campagna is not null and not vede_campagna(p_da_campagna) then
    raise exception 'Non autorizzato sulla campagna di partenza';
  end if;

  create temp table _cand on commit drop as
  select distinct a.id, a.non_chiamare, a.stato
  from aziende a
  where a.comune_norm = any (select norm_testo(x) from unnest(p_comuni) x)
     or (p_da_campagna is not null and a.id in (
          select azienda_id from campagna_aziende where campagna_id = p_da_campagna));

  select count(*) into n_candidate from _cand;
  select count(*) into n_non_chiamare from _cand where non_chiamare;
  select count(*) into n_chiuse from _cand where not non_chiamare and stato in ('chiusa', 'numero_errato');
  delete from _cand where non_chiamare or stato in ('chiusa', 'numero_errato');

  n_contratti := 0;
  if p_escludi_contratti then
    select count(*) into n_contratti from _cand c
    where exists (select 1 from appuntamenti ap where ap.azienda_id = c.id and ap.esito_contratto = 'firmato');
    delete from _cand c
    where exists (select 1 from appuntamenti ap where ap.azienda_id = c.id and ap.esito_contratto = 'firmato');
  end if;

  n_non_interessati := 0;
  if coalesce(p_mesi_non_interessati, 0) > 0 then
    select count(*) into n_non_interessati from _cand c
    where (select ch.esito from chiamate ch where ch.azienda_id = c.id
           order by ch.created_at desc limit 1) = 'non_interessato'
      and exists (select 1 from chiamate ch where ch.azienda_id = c.id and ch.esito = 'non_interessato'
                  and ch.created_at > now() - make_interval(months => p_mesi_non_interessati));
    delete from _cand c
    where (select ch.esito from chiamate ch where ch.azienda_id = c.id
           order by ch.created_at desc limit 1) = 'non_interessato'
      and exists (select 1 from chiamate ch where ch.azienda_id = c.id and ch.esito = 'non_interessato'
                  and ch.created_at > now() - make_interval(months => p_mesi_non_interessati));
  end if;

  select count(*) into n_gia from _cand c
  where exists (select 1 from campagna_aziende where campagna_id = p_campagna and azienda_id = c.id);

  if not p_anteprima then
    insert into campagna_aziende (campagna_id, azienda_id, aggiunta_da)
    select p_campagna, c.id, auth.uid() from _cand c
    on conflict do nothing;
    get diagnostics n_aggiunte = row_count;
  else
    n_aggiunte := (select count(*) from _cand) - n_gia;
  end if;

  return jsonb_build_object(
    'candidate', n_candidate, 'aggiunte', n_aggiunte, 'gia_in_lista', n_gia,
    'escluse_non_chiamare', n_non_chiamare, 'escluse_chiuse', n_chiuse,
    'escluse_contratti', n_contratti, 'escluse_non_interessati', n_non_interessati);
end $$;

-- Nuova campagna: chi la crea (se non è admin) se la ritrova assegnata
create or replace function crea_campagna(p_comune text, p_edizione text, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not ha_permesso('creare_campagne') then raise exception 'Non hai il permesso di creare campagne'; end if;
  if nullif(trim(p_comune), '') is null or nullif(trim(p_edizione), '') is null then
    raise exception 'Comune ed edizione sono obbligatori';
  end if;
  if exists (select 1 from campagne where norm_testo(comune) = norm_testo(p_comune) and trim(edizione) = trim(p_edizione)) then
    raise exception 'Esiste già una campagna per % edizione %', trim(p_comune), trim(p_edizione);
  end if;
  insert into campagne (comune, edizione, note, created_by)
  values (trim(p_comune), trim(p_edizione), nullif(p_note, ''), auth.uid())
  returning id into v;
  if not vede_tutto() then
    insert into campagne_assegnazioni (campagna_id, utente_id) values (v, auth.uid());
  end if;
  perform registra_attivita('ha creato la campagna ' || trim(p_comune) || ' · ' || trim(p_edizione));
  return v;
end $$;

-- Ricerca libera su tutto l'archivio (per chi compone le liste)
create or replace function cerca_aziende_archivio(p_testo text)
returns table (id uuid, ragione_sociale text, comune text, piva text, telefono text, non_chiamare boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not ha_permesso('creare_campagne') then raise exception 'Non autorizzato'; end if;
  return query
  select a.id, a.ragione_sociale, a.comune, a.piva, a.telefono, a.non_chiamare
  from aziende a
  where a.ragione_sociale ilike '%' || p_testo || '%'
     or a.piva_norm = norm_piva(p_testo)
     or a.telefono_norm = norm_tel(p_testo)
  order by a.ragione_sociale
  limit 25;
end $$;

create or replace function aggiungi_a_campagna(p_campagna uuid, p_azienda uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (ha_permesso('creare_campagne') and vede_campagna(p_campagna)) then
    raise exception 'Non autorizzato';
  end if;
  insert into campagna_aziende (campagna_id, azienda_id, aggiunta_da)
  values (p_campagna, p_azienda, auth.uid())
  on conflict do nothing;
end $$;

-- Nuova azienda inserita a mano dentro una campagna
create or replace function crea_azienda_in_campagna(p_campagna uuid, p_dati jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (puo_scrivere() and vede_campagna(p_campagna)) then
    raise exception 'Non autorizzato';
  end if;
  if nullif(trim(p_dati->>'ragione_sociale'), '') is null then
    raise exception 'Ragione sociale obbligatoria';
  end if;
  select id into v_id from aziende where piva_norm = norm_piva(p_dati->>'piva');
  if v_id is null then
    insert into aziende (ragione_sociale, piva, telefono, email, comune, provincia, settore, created_by)
    values (trim(p_dati->>'ragione_sociale'), nullif(p_dati->>'piva', ''), nullif(p_dati->>'telefono', ''),
            nullif(p_dati->>'email', ''), nullif(trim(p_dati->>'comune'), ''),
            nullif(p_dati->>'provincia', ''), nullif(p_dati->>'settore', ''), auth.uid())
    returning id into v_id;
  end if;
  insert into campagna_aziende (campagna_id, azienda_id, aggiunta_da)
  values (p_campagna, v_id, auth.uid())
  on conflict do nothing;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Numeri per elenco campagne
-- ---------------------------------------------------------------------
create or replace function statistiche_campagne()
returns table (campagna_id uuid, totale bigint, lavorate bigint, appuntamenti bigint, contratti bigint)
language sql stable security definer set search_path = public as $$
  select c.id,
    (select count(*) from campagna_aziende ca where ca.campagna_id = c.id),
    (select count(*) from campagna_aziende ca where ca.campagna_id = c.id
       and (ca.tentativi > 0 or ca.stato <> 'da_chiamare')),
    (select count(*) from appuntamenti ap where ap.campagna_id = c.id and not ap.annullato),
    (select count(*) from appuntamenti ap where ap.campagna_id = c.id and ap.esito_contratto = 'firmato')
  from campagne c
  where vede_campagna(c.id)
$$;

create or replace function conteggi_campagna(p_campagna uuid)
returns table (stato stato_in_campagna, quante bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not vede_campagna(p_campagna) then raise exception 'Non autorizzato'; end if;
  return query select ca.stato, count(*) from campagna_aziende ca
  where ca.campagna_id = p_campagna group by ca.stato;
end $$;

-- ---------------------------------------------------------------------
-- Centro di controllo
-- ---------------------------------------------------------------------
create or replace function stato_sistema() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Non autorizzato'; end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'aziende', (select count(*) from aziende),
    'chiamate', (select count(*) from chiamate),
    'appuntamenti', (select count(*) from appuntamenti));
end $$;

-- ---------------------------------------------------------------------
-- Accesso alle funzioni: solo utenti autenticati
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema public to service_role;
