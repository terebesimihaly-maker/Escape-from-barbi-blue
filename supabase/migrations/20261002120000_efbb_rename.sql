-- Escape from Barbi Blue: changing your username (the profile's "Save name"). The same rules as signing up: 3 to 16 letters,
-- numbers or _, and no one else may have it (in any capitals). The session stays valid; the password doesn't change.
create or replace function public.efbb_rename(p_token text, p_username text) returns json
language plpgsql security definer set search_path = '' as $$
declare pid uuid := efbb.player_of(p_token);
begin
  if pid is null then return json_build_object('error', 'bad_session'); end if;
  if p_username is null or p_username !~ '^[A-Za-z0-9_]{3,16}$' then return json_build_object('error', 'bad_username'); end if;
  if exists (select 1 from efbb.players where lower(username) = lower(p_username) and id <> pid) then return json_build_object('error', 'taken'); end if;
  begin
    update efbb.players set username = p_username, updated_at = now() where id = pid;
  exception when unique_violation then return json_build_object('error', 'taken');      -- (two renames to one name at the same moment)
  end;
  return json_build_object('ok', true, 'username', p_username);
end $$;

-- like the other five: only the public (anon) role calls it (functions are executable by PUBLIC by default)
revoke execute on function public.efbb_rename(text, text) from public, authenticated;
grant execute on function public.efbb_rename(text, text) to anon;
