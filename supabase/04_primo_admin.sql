-- Dopo aver creato il TUO utente in Supabase (Authentication → Users → Add user),
-- sostituisci l'email qui sotto ed esegui: diventi amministratore.
update profili
set ruolo = 'admin', nome = 'Lorenzo Bello'
where email = 'lorenzo.bello@welfarecare.org';

select email, nome, ruolo from profili;
