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
