-- JAFT migration 003: a next step may be planned for the same day as the entry.
--
-- Until now a next step had to come after the entry's date (for example: called this morning,
-- call again this afternoon was refused). It now has to come on or after that date.
-- The old check had no name of its own, so it is found by its definition and replaced by a named one.
--
-- Runs as one transaction: if any statement fails, nothing changes.

begin;

do $$
declare
  old_name text;
begin
  select conname into old_name
    from pg_constraint
   where conrelid = 'public.history_entries'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%next_step_on > happened_on%';
  if old_name is null then
    raise exception 'The old next-step check was not found; nothing changed.';
  end if;
  execute format('alter table public.history_entries drop constraint %I', old_name);
end $$;

alter table history_entries add constraint history_entries_next_step_not_before
  check (next_step_on is null or next_step_on >= happened_on);

insert into schema_migrations (version, name) values (3, 'next_step_same_day');

commit;
