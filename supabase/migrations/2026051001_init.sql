create extension if not exists "pgcrypto";

do $$
begin
  create type session_status as enum ('active', 'archived');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type artifact_status as enum ('uploaded', 'parsing', 'ready', 'failed');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type export_format as enum ('md', 'pdf');
exception
  when duplicate_object then null;
end $$;

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create unique index if not exists profiles_user_id_idx on profiles(user_id);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  mode text,
  status session_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sessions_user_id_idx on sessions(user_id);

create table if not exists turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  persona text not null,
  role text,
  content text not null,
  tokens integer,
  created_at timestamptz not null default now(),
  order_index integer not null
);

create index if not exists turns_session_id_idx on turns(session_id);

create table if not exists artifacts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  filename text not null,
  mime text not null,
  size integer not null,
  status artifact_status not null default 'uploaded',
  parsed_text text,
  created_at timestamptz not null default now()
);

create index if not exists artifacts_session_id_idx on artifacts(session_id);

create table if not exists exports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  format export_format not null,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists exports_session_id_idx on exports(session_id);

create table if not exists retention_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists retention_events_user_id_idx on retention_events(user_id);
