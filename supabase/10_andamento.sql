-- =====================================================================
-- Dashboard "Andamento agenti" (amministratore e direzione).
-- Le funzioni girano con i permessi di chi le usa: i dati li filtrano
-- le regole per riga (admin e direzione vedono tutto).
-- Da eseguire una volta nel SQL Editor di Supabase.
-- =====================================================================

create index if not exists app_inizio on appuntamenti (inizio);
create index if not exists app_operatore on appuntamenti (operatore_id, created_at);

-- Riepilogo per incaricato nel periodo (appuntamenti con data nel periodo)
create or replace function public.andamento_incaricati(p_da timestamptz, p_a timestamptz, p_campagna uuid default null)
returns table (
  incaricato_id uuid, nome text, zona text, attivo boolean,
  ricevuti bigint, svolti bigint, rimandati bigint, non_svolti bigint,
  contratti bigint, trattativa bigint, no_contratto bigint, mancanti bigint, prossimi7 bigint
)
language sql stable security invoker set search_path = public, private as $$
  select p.id, p.nome, p.zona, p.attivo,
    count(a.id) filter (where a.id is not null),
    count(*) filter (where a.esito_incontro = 'svolto'),
    count(*) filter (where a.esito_incontro = 'rimandato'),
    count(*) filter (where a.esito_incontro = 'non_svolto'),
    count(*) filter (where a.esito_contratto = 'firmato'),
    count(*) filter (where a.esito_contratto = 'in_trattativa'),
    count(*) filter (where a.esito_contratto = 'no'),
    count(*) filter (where a.esito_incontro is null and a.fine < now()),
    (select count(*) from appuntamenti x
      where x.incaricato_id = p.id and not x.annullato
        and x.inizio >= now() and x.inizio < now() + interval '7 days'
        and (p_campagna is null or x.campagna_id = p_campagna))
  from profili p
  left join appuntamenti a
    on a.incaricato_id = p.id and not a.annullato
   and a.inizio >= p_da and a.inizio < p_a
   and (p_campagna is null or a.campagna_id = p_campagna)
  where p.ruolo = 'incaricato'
  group by p.id
  having p.attivo or count(a.id) > 0
$$;

-- Riepilogo per operatore nel periodo
create or replace function public.andamento_operatori(p_da timestamptz, p_a timestamptz, p_campagna uuid default null)
returns table (
  operatore_id uuid, nome text, giorni_attivi bigint, chiamate bigint, utili bigint,
  appuntamenti bigint, passati bigint, svolti bigint, contratti bigint
)
language sql stable security invoker set search_path = public, private as $$
  with ch as (
    select c.operatore_id,
      count(*) as chiamate,
      count(distinct (c.created_at at time zone 'Europe/Rome')::date) as giorni,
      count(*) filter (where c.esito not in ('non_risponde', 'occupato', 'segreteria', 'numero_errato')) as utili
    from chiamate c
    where c.created_at >= p_da and c.created_at < p_a
      and (p_campagna is null or c.campagna_id = p_campagna)
    group by c.operatore_id
  ), ap as (
    select a.operatore_id,
      count(*) as appuntamenti,
      count(*) filter (where a.fine < now()) as passati,
      count(*) filter (where a.esito_incontro = 'svolto') as svolti,
      count(*) filter (where a.esito_contratto = 'firmato') as contratti
    from appuntamenti a
    where not a.annullato and a.created_at >= p_da and a.created_at < p_a
      and (p_campagna is null or a.campagna_id = p_campagna)
    group by a.operatore_id
  )
  select p.id, p.nome, coalesce(ch.giorni, 0), coalesce(ch.chiamate, 0), coalesce(ch.utili, 0),
         coalesce(ap.appuntamenti, 0), coalesce(ap.passati, 0), coalesce(ap.svolti, 0), coalesce(ap.contratti, 0)
  from profili p
  left join ch on ch.operatore_id = p.id
  left join ap on ap.operatore_id = p.id
  where (ch.operatore_id is not null or ap.operatore_id is not null)
$$;

-- Andamento settimanale di un incaricato (ultime N settimane)
create or replace function public.andamento_settimane(p_incaricato uuid, p_settimane int default 8, p_campagna uuid default null)
returns table (settimana date, ricevuti bigint, svolti bigint, contratti bigint)
language sql stable security invoker set search_path = public, private as $$
  with s as (
    select generate_series(
      date_trunc('week', (now() at time zone 'Europe/Rome'))::date - (p_settimane - 1) * 7,
      date_trunc('week', (now() at time zone 'Europe/Rome'))::date,
      interval '7 days')::date as settimana
  )
  select s.settimana,
    count(a.id),
    count(*) filter (where a.esito_incontro = 'svolto'),
    count(*) filter (where a.esito_contratto = 'firmato')
  from s
  left join appuntamenti a
    on a.incaricato_id = p_incaricato and not a.annullato
   and date_trunc('week', a.inizio at time zone 'Europe/Rome')::date = s.settimana
   and (p_campagna is null or a.campagna_id = p_campagna)
  group by s.settimana
  order by s.settimana
$$;

revoke execute on function public.andamento_incaricati(timestamptz, timestamptz, uuid) from public, anon;
revoke execute on function public.andamento_operatori(timestamptz, timestamptz, uuid) from public, anon;
revoke execute on function public.andamento_settimane(uuid, int, uuid) from public, anon;
grant execute on function public.andamento_incaricati(timestamptz, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.andamento_operatori(timestamptz, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.andamento_settimane(uuid, int, uuid) to authenticated, service_role;
