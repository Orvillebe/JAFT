-- JAFT migration 005: a company can be inactive ("leave alone for now"), like a contact.
--
-- companies.active / inactive_since   the company's status and since when it rests
-- history_entries.with_company        a contact's status change made together with its company's,
--                                     so reactivating the company can suggest who comes back with it
-- set_company_status(...)             the company and its contacts' status entries in one transaction
--
-- Everything that exists stays active. Runs as one transaction: if any statement fails, nothing changes.

begin;

alter table companies
  add column active boolean not null default true,
  add column inactive_since date,
  add constraint companies_inactive_since check (active = (inactive_since is null));

alter table history_entries add column with_company boolean not null default false;

-- Sets a company active or inactive, and gives the listed persons of that company a status entry
-- with the same status (with_company = true). Returns the company and the new entries.
create or replace function set_company_status(company_id text, active boolean, day date, person_ids text[])
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  c companies;
  es jsonb;
begin
  update companies
     set active = set_company_status.active,
         inactive_since = case when set_company_status.active then null else set_company_status.day end
   where companies.id = set_company_status.company_id
  returning * into c;
  if c.id is null then
    raise exception 'Company % not found', set_company_status.company_id;
  end if;

  with ins as (
    insert into history_entries (person_id, kind, happened_on, status, with_company)
    select p.id, 'status', set_company_status.day,
           case when set_company_status.active then 'active' else 'inactive' end, true
      from persons p
     where p.id = any(set_company_status.person_ids)
       and p.company_id = set_company_status.company_id
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb) into es from ins;

  return jsonb_build_object('company', to_jsonb(c), 'entries', es);
end;
$$;

grant execute on function public.set_company_status(text, boolean, date, text[]) to authenticated;
revoke execute on function public.set_company_status(text, boolean, date, text[]) from anon, public;

insert into schema_migrations (version, name) values (5, 'company_status');

commit;
