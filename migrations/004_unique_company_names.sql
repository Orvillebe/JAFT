-- JAFT migration 004: two active companies can no longer have the same name.
--
-- "The same" ignores capitals and spaces at the start or end: 'Govaplast' and ' GOVAPLAST' are one name.
-- Only active companies count. An archived company or one in the bin does not hold on to its name;
-- the app asks for another name when restoring it while the name is taken.
--
-- If active companies with the same name exist already, this stops and names them; nothing changes.
-- Merge them first (link the contacts to one company, delete the empty one), then run this again.
--
-- Runs as one transaction: if any statement fails, nothing changes.

begin;

do $$
declare
  same text;
begin
  select string_agg(name, ', ' order by name) into same
    from (select min(name) as name
            from public.companies
           where archived_at is null and deleted_at is null
           group by lower(btrim(name))
          having count(*) > 1) d;
  if same is not null then
    raise exception 'Active companies with the same name: %. Merge them first; nothing changed.', same;
  end if;
end $$;

create unique index companies_active_name_unique on companies (lower(btrim(name)))
  where archived_at is null and deleted_at is null;

insert into schema_migrations (version, name) values (4, 'unique_company_names');

commit;
