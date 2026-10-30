-- JAFT migration 002: an access list. Logged in is not enough; you also have to be on the list.
--
-- Every rule changes from "logged in" to "logged in and on the list" (is_allowed()). A new account,
-- for example one created by mistake or after sign-up was switched on by accident, gets a members
-- row with allowed = false: it can log in, but sees and changes nothing.
--
-- Giving someone access: Table Editor > members > set allowed to true (as the database owner).
-- Everyone who exists when this runs keeps access.
--
-- Runs as one transaction: if any statement fails, nothing changes.

begin;

-- =====================
-- The list
-- =====================

alter table members add column allowed boolean not null default false;
update members set allowed = true;

-- Is the logged-in user on the list? security definer, so it can read members regardless of the
-- caller's own rules; stable, so it is evaluated once per statement.
create or replace function is_allowed()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from members where id = auth.uid() and allowed);
$$;
revoke execute on function is_allowed() from public, anon;
grant execute on function is_allowed() to authenticated;

-- =====================
-- Members: nobody can put themselves on the list
-- =====================
-- Profiles are created by the trigger (handle_new_user), never by the app, and a user may only
-- change their own name. Without this, someone could set allowed = true on their own row.

revoke insert, update on members from authenticated;
grant update (name) on members to authenticated;
drop policy "insert own member" on members;

-- Your own row is always readable, so the app can tell you that you aren't on the list yet.
drop policy "read members" on members;
create policy "read members" on members for select to authenticated using (id = auth.uid() or is_allowed());

drop policy "update own member" on members;
create policy "update own member" on members for update to authenticated
  using (id = auth.uid() and is_allowed()) with check (id = auth.uid());

-- =====================
-- Every other rule: logged in and on the list
-- =====================

drop policy "read companies" on companies;
drop policy "insert companies" on companies;
drop policy "update companies" on companies;
drop policy "delete companies" on companies;
create policy "read companies" on companies for select to authenticated using (is_allowed());
create policy "insert companies" on companies for insert to authenticated with check (is_allowed());
create policy "update companies" on companies for update to authenticated using (is_allowed()) with check (is_allowed());
create policy "delete companies" on companies for delete to authenticated using (is_allowed());

drop policy "read persons" on persons;
drop policy "insert persons" on persons;
drop policy "update persons" on persons;
drop policy "delete persons" on persons;
create policy "read persons" on persons for select to authenticated using (is_allowed());
create policy "insert persons" on persons for insert to authenticated with check (is_allowed());
create policy "update persons" on persons for update to authenticated using (is_allowed()) with check (is_allowed());
create policy "delete persons" on persons for delete to authenticated using (is_allowed());

drop policy "read history" on history_entries;
drop policy "insert history" on history_entries;
drop policy "update history" on history_entries;
drop policy "delete history" on history_entries;
create policy "read history" on history_entries for select to authenticated using (is_allowed());
create policy "insert history" on history_entries for insert to authenticated with check (is_allowed());
create policy "update history" on history_entries for update to authenticated using (is_allowed()) with check (is_allowed());
create policy "delete history" on history_entries for delete to authenticated using (is_allowed());

drop policy "read stages" on stages;
drop policy "insert middle stages" on stages;
drop policy "update stages" on stages;
create policy "read stages" on stages for select to authenticated using (is_allowed());
create policy "insert middle stages" on stages for insert to authenticated with check (is_allowed() and kind = 'middle');
create policy "update stages" on stages for update to authenticated using (is_allowed()) with check (is_allowed());

drop policy "read stage changes" on stage_changes;
drop policy "insert stage changes" on stage_changes;
create policy "read stage changes" on stage_changes for select to authenticated using (is_allowed());
-- The fixed stages can never be archived.
create policy "insert stage changes" on stage_changes for insert to authenticated
  with check (is_allowed() and stage_id not in ('contact', 'order'));

drop policy "read week actions" on week_actions;
drop policy "insert week actions" on week_actions;
drop policy "delete own week actions" on week_actions;
create policy "read week actions" on week_actions for select to authenticated using (is_allowed());
create policy "insert week actions" on week_actions for insert to authenticated with check (is_allowed() and created_by = auth.uid());
create policy "delete own week actions" on week_actions for delete to authenticated using (is_allowed() and created_by = auth.uid());

drop policy "read settings" on app_settings;
drop policy "insert settings" on app_settings;
drop policy "update settings" on app_settings;
create policy "read settings" on app_settings for select to authenticated using (is_allowed());
create policy "insert settings" on app_settings for insert to authenticated with check (is_allowed());
create policy "update settings" on app_settings for update to authenticated using (is_allowed()) with check (is_allowed());

-- schema_migrations stays readable for everyone logged in: the app checks the version first,
-- and only then whether you are on the list.

-- =====================
-- Record this migration
-- =====================

insert into schema_migrations (version, name) values (2, 'access_list');

commit;
