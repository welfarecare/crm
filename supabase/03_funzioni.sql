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
