-- Im Supabase Dashboard unter "SQL Editor" einfügen und ausführen.

create extension if not exists "pgcrypto";

create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  weekday int not null,       -- 0 = Montag ... 6 = Sonntag
  time text not null,         -- "16:00"
  duration int not null default 60,
  created_at timestamptz default now()
);

create table students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  group_id uuid references groups(id) on delete set null,
  created_at timestamptz default now()
);

create table attendance (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  date date not null,
  cancelled boolean default false,
  present jsonb default '{}'::jsonb,
  unique (group_id, date)
);

create table invoices (
  id uuid primary key default gen_random_uuid(),
  group_id uuid,
  group_name text,
  year int,
  month_idx int,
  generated_at timestamptz default now(),
  held_count int,
  price_per_training_per_student numeric,
  per_student_total numeric,
  total numeric,
  students jsonb
);

create table biller (
  id int primary key default 1,
  name text default '',
  address text default ''
);
insert into biller (id) values (1);

-- Einfache Konfiguration ohne Login: RLS aktiv, aber offen für den "anon"-Key.
-- Das Tool ist dann über die Web-URL für jeden nutzbar, der den Link kennt.
-- Für mehr Schutz später: Vercel-Passwortschutz oder echte Supabase-Auth ergänzen.
alter table groups enable row level security;
alter table students enable row level security;
alter table attendance enable row level security;
alter table invoices enable row level security;
alter table biller enable row level security;

create policy "allow all groups" on groups for all using (true) with check (true);
create policy "allow all students" on students for all using (true) with check (true);
create policy "allow all attendance" on attendance for all using (true) with check (true);
create policy "allow all invoices" on invoices for all using (true) with check (true);
create policy "allow all biller" on biller for all using (true) with check (true);
