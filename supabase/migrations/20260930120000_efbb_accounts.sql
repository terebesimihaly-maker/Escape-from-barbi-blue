-- Escape from Barbi Blue: player accounts (username + password) and their character.
-- Everything is reached through five functions (sign up, sign in, who am I, save my look, sign out) that the game calls
-- with the project's publishable key. The tables live in a schema the API doesn't expose, so nothing else can read them.
-- Passwords are stored only as bcrypt hashes. A sign-in gives a random session token; only its SHA-256 is stored.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists efbb;
revoke all on schema efbb from public, anon, authenticated;

create table if not exists efbb.players (
  id uuid primary key default gen_random_uuid(),
  username text not null check (username ~ '^[A-Za-z0-9_]{3,16}$'),
  pass_hash text not null,
  look jsonb not null default '{}'::jsonb check (jsonb_typeof(look) = 'object' and pg_column_size(look) < 4096),
  failed int not null default 0,              -- wrong passwords in a row
  locked_until timestamptz,                   -- after too many: a short lock
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists players_username_lower on efbb.players (lower(username));

create table if not exists efbb.sessions (
  token_hash text primary key,
  player_id uuid not null references efbb.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '90 days'
);
create index if not exists sessions_player on efbb.sessions (player_id);

-- sign-ups per address per hour (a little protection against someone creating thousands of accounts)
create table if not exists efbb.signups (ip text not null, at timestamptz not null default now());
create index if not exists signups_ip_at on efbb.signups (ip, at);

revoke all on all tables in schema efbb from public, anon, authenticated;

-- a new session for a player: returns the token (the caller keeps it; we keep only its hash). At most 10 per player.
create or replace function efbb.new_session(p_player uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare t text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into efbb.sessions (token_hash, player_id) values (encode(extensions.digest(t, 'sha256'), 'hex'), p_player);
  delete from efbb.sessions where player_id = p_player and token_hash in (
    select token_hash from efbb.sessions where player_id = p_player order by created_at desc offset 10);
  return t;
end $$;

-- the player a token belongs to (null if it's unknown or expired)
create or replace function efbb.player_of(p_token text) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.player_id from efbb.sessions s
  where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and s.expires_at > now()
$$;

-- (every answer is JSON: the data, or { "error": "..." }. Errors are returned, not raised: raising would undo the call,
-- and with it the count of wrong passwords that locks an account for a while)
create or replace function public.efbb_sign_up(p_username text, p_password text, p_look jsonb default '{}'::jsonb) returns json
language plpgsql security definer set search_path = '' as $$
declare pid uuid; v_ip text := coalesce(nullif(split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1), ''), '?');
begin
  if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,16}$' then return json_build_object('error', 'bad_username'); end if;
  if p_password is null or length(p_password) < 6 or octet_length(p_password) > 72 then return json_build_object('error', 'bad_password'); end if;
  if (select count(*) from efbb.signups s where s.ip = v_ip and s.at > now() - interval '1 hour') >= 10 then return json_build_object('error', 'too_many'); end if;
  if exists (select 1 from efbb.players where lower(username) = lower(p_username)) then return json_build_object('error', 'taken'); end if;
  if p_look is null or jsonb_typeof(p_look) <> 'object' or pg_column_size(p_look) >= 4096 then p_look := '{}'::jsonb; end if;
  insert into efbb.signups (ip) values (v_ip);
  delete from efbb.signups where at < now() - interval '1 day';
  begin
    insert into efbb.players (username, pass_hash, look) values (p_username, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), p_look)
      returning id into pid;
  exception when unique_violation then return json_build_object('error', 'taken');      -- (two sign-ups with one name at the same moment)
  end;
  return json_build_object('token', efbb.new_session(pid), 'username', p_username, 'look', p_look);
end $$;

create or replace function public.efbb_sign_in(p_username text, p_password text) returns json
language plpgsql security definer set search_path = '' as $$
declare p efbb.players;
begin
  select * into p from efbb.players where lower(username) = lower(coalesce(p_username, ''));
  if p.id is null then return json_build_object('error', 'bad_login'); end if;
  if p.locked_until is not null and p.locked_until > now() then return json_build_object('error', 'locked'); end if;
  if p.pass_hash <> extensions.crypt(coalesce(p_password, ''), p.pass_hash) then
    -- (8 wrong in a row: locked for 10 minutes, and the count starts again)
    update efbb.players set locked_until = case when failed + 1 >= 8 then now() + interval '10 minutes' else locked_until end,
      failed = case when failed + 1 >= 8 then 0 else failed + 1 end
    where id = p.id;
    return json_build_object('error', 'bad_login');
  end if;
  update efbb.players set failed = 0, locked_until = null where id = p.id;
  return json_build_object('token', efbb.new_session(p.id), 'username', p.username, 'look', p.look);
end $$;

create or replace function public.efbb_me(p_token text) returns json
language plpgsql stable security definer set search_path = '' as $$
declare p efbb.players;
begin
  select * into p from efbb.players where id = efbb.player_of(p_token);
  if p.id is null then return json_build_object('error', 'bad_session'); end if;
  return json_build_object('username', p.username, 'look', p.look);
end $$;

create or replace function public.efbb_save_look(p_token text, p_look jsonb) returns json
language plpgsql security definer set search_path = '' as $$
declare pid uuid := efbb.player_of(p_token);
begin
  if pid is null then return json_build_object('error', 'bad_session'); end if;
  if p_look is null or jsonb_typeof(p_look) <> 'object' or pg_column_size(p_look) >= 4096 then return json_build_object('error', 'bad_look'); end if;
  update efbb.players set look = p_look, updated_at = now() where id = pid;
  return json_build_object('ok', true);
end $$;

create or replace function public.efbb_sign_out(p_token text) returns json
language sql security definer set search_path = '' as $$
  delete from efbb.sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  select json_build_object('ok', true);
$$;

-- only the five functions are callable from the game; the helpers and the tables are not
revoke all on function efbb.new_session(uuid), efbb.player_of(text) from public, anon, authenticated;
revoke all on function public.efbb_sign_up(text, text, jsonb), public.efbb_sign_in(text, text), public.efbb_me(text),
  public.efbb_save_look(text, jsonb), public.efbb_sign_out(text) from public;
grant execute on function public.efbb_sign_up(text, text, jsonb), public.efbb_sign_in(text, text), public.efbb_me(text),
  public.efbb_save_look(text, jsonb), public.efbb_sign_out(text) to anon, authenticated;
