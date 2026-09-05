create extension if not exists pgcrypto;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null check (room_id ~ '^[A-Za-z0-9_-]{6,48}$'),
  client_id text not null check (length(client_id) between 8 and 128),
  name text not null check (length(name) between 1 and 24),
  content text not null check (char_length(content) between 1 and 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists chat_messages_room_created_idx on public.chat_messages(room_id, created_at desc);
create index if not exists chat_messages_expires_idx on public.chat_messages(expires_at);

create table if not exists public.rate_limits (
  key_hash text primary key,
  window_start timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.chat_messages enable row level security;
alter table public.rate_limits enable row level security;

revoke all on public.chat_messages from anon, authenticated;
revoke all on public.rate_limits from anon, authenticated;
grant select, insert, update, delete on public.chat_messages to service_role;
grant select, insert, update, delete on public.rate_limits to service_role;

create or replace function public.check_rate_limit(
  p_key text,
  p_max integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_start timestamptz;
  v_count integer;
  v_allowed boolean;
begin
  if p_max < 1 or p_window_seconds < 1 then
    return false;
  end if;

  insert into public.rate_limits(key_hash, window_start, request_count, updated_at)
  values(p_key, v_now, 1, v_now)
  on conflict (key_hash) do update set
    request_count = case
      when v_now - public.rate_limits.window_start >= make_interval(secs => p_window_seconds)
        then 1
      else public.rate_limits.request_count + 1
    end,
    window_start = case
      when v_now - public.rate_limits.window_start >= make_interval(secs => p_window_seconds)
        then v_now
      else public.rate_limits.window_start
    end,
    updated_at = v_now
  returning window_start, request_count into v_start, v_count;

  v_allowed := v_count <= p_max;
  return v_allowed;
end;
$$;

revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

create or replace function public.prune_chat_data() returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.chat_messages where expires_at < now();
  delete from public.rate_limits where updated_at < now() - interval '2 hours';
end;
$$;

revoke all on function public.prune_chat_data() from public, anon, authenticated;
grant execute on function public.prune_chat_data() to service_role;
