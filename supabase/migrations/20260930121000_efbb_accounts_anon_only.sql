-- the game doesn't use Supabase's own sign-in, so only the public (anon) role needs these five functions
revoke execute on function public.efbb_sign_up(text, text, jsonb), public.efbb_sign_in(text, text), public.efbb_me(text),
  public.efbb_save_look(text, jsonb), public.efbb_sign_out(text) from authenticated;
