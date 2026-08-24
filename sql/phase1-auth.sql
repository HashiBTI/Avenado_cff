-- =====================================================================
-- CFF — Company Formation Framework
-- Phase 1: Authentication + User Profiles
--
-- HOW TO RUN
--   1. Open your Supabase project → SQL Editor → New query
--   2. Paste this entire file
--   3. Press Run
--
-- Safe to run more than once (everything is IF NOT EXISTS / OR REPLACE).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PROFILES TABLE
--
-- One row per authenticated user. `id` is a foreign key onto Supabase's
-- built-in auth.users table, so deleting an account automatically
-- removes the profile too.
-- ---------------------------------------------------------------------

create table if not exists public.profiles (
    id            uuid primary key references auth.users (id) on delete cascade,
    full_name     text,
    email         text,
    phone         text,
    profile_type  text not null default 'visitor',
    company       text,
    job_title     text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

-- Only the three profile types the app knows about are allowed.
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'profiles_profile_type_check'
    ) then
        alter table public.profiles
            add constraint profiles_profile_type_check
            check (profile_type in ('visitor', 'owner', 'employee'));
    end if;
end $$;

comment on table public.profiles is
    'Application profile for each authenticated CFF user. Assessment data in later phases references profiles.id.';


-- ---------------------------------------------------------------------
-- 2. ROW LEVEL SECURITY
--
-- This is what makes it safe to ship the publishable (anon) key in the
-- browser: a logged-in user can only ever read or write THEIR OWN row.
-- Without these policies, enabling RLS blocks everything by default.
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile"   on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;

create policy "Users can read own profile"
    on public.profiles
    for select
    to authenticated
    using (auth.uid() = id);

create policy "Users can insert own profile"
    on public.profiles
    for insert
    to authenticated
    with check (auth.uid() = id);

create policy "Users can update own profile"
    on public.profiles
    for update
    to authenticated
    using (auth.uid() = id)
    with check (auth.uid() = id);

-- Deliberately no DELETE policy: accounts are removed via auth.users,
-- and the cascade above takes the profile with it.


-- ---------------------------------------------------------------------
-- 3. AUTO-CREATE A PROFILE ON SIGN UP
--
-- The signup form sends full_name / phone / profile_type as user
-- metadata. This trigger copies them into public.profiles the instant
-- the auth user is created — so the profile exists even when email
-- confirmation is switched on and the user only clicks the link days
-- later.
--
-- SECURITY DEFINER lets the trigger write past RLS; the fixed
-- search_path stops it being hijacked by a shadowed function name.
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (
        id, full_name, email, phone, profile_type, company, job_title
    )
    values (
        new.id,
        new.raw_user_meta_data ->> 'full_name',
        new.email,
        new.raw_user_meta_data ->> 'phone',
        coalesce(nullif(new.raw_user_meta_data ->> 'profile_type', ''), 'visitor'),
        nullif(new.raw_user_meta_data ->> 'company', ''),
        nullif(new.raw_user_meta_data ->> 'job_title', '')
    )
    on conflict (id) do nothing;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
    after insert on auth.users
    for each row
    execute function public.handle_new_user();


-- ---------------------------------------------------------------------
-- 4. KEEP updated_at HONEST
-- ---------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;

create trigger profiles_touch_updated_at
    before update on public.profiles
    for each row
    execute function public.touch_updated_at();


-- ---------------------------------------------------------------------
-- 5. BACKFILL
--
-- If you already created test accounts before running this file, this
-- gives them profile rows too.
-- ---------------------------------------------------------------------

insert into public.profiles (id, full_name, email, phone, profile_type, company, job_title)
select
    u.id,
    u.raw_user_meta_data ->> 'full_name',
    u.email,
    u.raw_user_meta_data ->> 'phone',
    coalesce(nullif(u.raw_user_meta_data ->> 'profile_type', ''), 'visitor'),
    nullif(u.raw_user_meta_data ->> 'company', ''),
    nullif(u.raw_user_meta_data ->> 'job_title', '')
from auth.users u
on conflict (id) do nothing;


-- ---------------------------------------------------------------------
-- 6. VERIFY
--
-- Run these after the migration to confirm everything landed.
-- ---------------------------------------------------------------------

-- select id, full_name, email, phone, profile_type, created_at
-- from public.profiles
-- order by created_at desc;

-- select tablename, policyname, cmd
-- from pg_policies
-- where schemaname = 'public' and tablename = 'profiles';
