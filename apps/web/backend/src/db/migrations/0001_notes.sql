create table notes (
  id text primary key not null,
  owner_id text not null references auth_user(id) on delete cascade,
  body text not null check(length(trim(body)) between 1 and 280),
  created_at text not null
);
create index notes_owner_created on notes(owner_id, created_at desc, id desc);
