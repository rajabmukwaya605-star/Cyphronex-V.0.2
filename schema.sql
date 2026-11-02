-- Cyphronex-Bluevane: Supabase schema (run once in Supabase > SQL Editor)
-- Tables: profiles, conversations (direct | group | channel), participants, messages, statuses
-- Storage buckets: avatars, attachments

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique,
  display_name text,
  cyphron_tag text unique,
  avatar_url text,
  bio text default 'Secured by Cyphronex-Bluevane E2EE',
  public_key text,
  key_fingerprint text,
  status text default 'online',
  theme_preference jsonb,
  last_seen timestamptz default now() not null,
  created_at timestamptz default now() not null
);

create table if not exists public.conversations (
  id uuid default gen_random_uuid() primary key,
  type text check (type in ('direct','group','channel')) default 'direct',
  name text,
  description text,
  avatar_url text,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz default now() not null
);

create table if not exists public.participants (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  user_id uuid references public.profiles(id) on delete cascade not null,
  role text check (role in ('owner','admin','member')) default 'member',
  joined_at timestamptz default now() not null,
  unique (conversation_id, user_id)
);

create table if not exists public.messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references public.conversations(id) on delete cascade not null,
  sender_id uuid references public.profiles(id) on delete cascade not null,
  body text default '',          -- plaintext (groups/channels) or base64 AES-GCM ciphertext (direct chats)
  iv text,                       -- set only when body is ciphertext
  attachment jsonb,              -- {url,name,type,size}
  created_at timestamptz default now() not null
);
create index if not exists messages_conv_idx on public.messages (conversation_id, created_at);

create table if not exists public.statuses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references public.profiles(id) on delete cascade not null,
  kind text check (kind in ('text','image')) default 'text',
  content text,
  bg text,
  media_url text,
  created_at timestamptz default now() not null,
  expires_at timestamptz default now() + interval '24 hours' not null
);

-- Helper functions (security definer avoids recursive RLS on participants)
create or replace function public.is_member(cid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from participants where conversation_id = cid and user_id = auth.uid());
$$;
create or replace function public.can_post(cid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from participants p join conversations c on c.id = p.conversation_id
    where p.conversation_id = cid and p.user_id = auth.uid()
      and (c.type <> 'channel' or p.role in ('owner','admin')));
$$;
create or replace function public.conv_type(cid uuid) returns text
language sql security definer set search_path = public stable as $$
  select type from conversations where id = cid;
$$;

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.participants enable row level security;
alter table public.messages enable row level security;
alter table public.statuses enable row level security;

create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "profiles insert own" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "profiles update own" on public.profiles for update to authenticated using (auth.uid() = id);

create policy "conversations read" on public.conversations for select to authenticated
  using (type = 'channel' or created_by = auth.uid() or public.is_member(id));
create policy "conversations create" on public.conversations for insert to authenticated
  with check (created_by = auth.uid());
create policy "conversations update by owner" on public.conversations for update to authenticated
  using (created_by = auth.uid());
create policy "conversations delete by owner" on public.conversations for delete to authenticated
  using (created_by = auth.uid());

create policy "participants read" on public.participants for select to authenticated
  using (user_id = auth.uid() or public.is_member(conversation_id));
create policy "participants add" on public.participants for insert to authenticated
  with check (
    exists (select 1 from conversations c where c.id = conversation_id and c.created_by = auth.uid())
    or (user_id = auth.uid() and role = 'member' and public.conv_type(conversation_id) = 'channel'));
create policy "participants leave or remove" on public.participants for delete to authenticated
  using (user_id = auth.uid()
    or exists (select 1 from conversations c where c.id = conversation_id and c.created_by = auth.uid()));

create policy "messages read" on public.messages for select to authenticated using (public.is_member(conversation_id));
create policy "messages send" on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.can_post(conversation_id));
create policy "messages delete own" on public.messages for delete to authenticated using (sender_id = auth.uid());

create policy "statuses read active" on public.statuses for select to authenticated using (expires_at > now());
create policy "statuses insert own" on public.statuses for insert to authenticated with check (user_id = auth.uid());
create policy "statuses delete own" on public.statuses for delete to authenticated using (user_id = auth.uid());

-- Realtime
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.statuses;
alter publication supabase_realtime add table public.participants;

-- Auto-create a profile on sign-up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare base text; begin
  base := coalesce(nullif(new.raw_user_meta_data->>'username',''), split_part(new.email,'@',1));
  insert into public.profiles (id, username, display_name, cyphron_tag)
  values (new.id,
          lower(base) || '_' || substr(md5(random()::text),1,4),
          coalesce(nullif(new.raw_user_meta_data->>'display_name',''), base),
          'CYPH-' || upper(substr(md5(random()::text),1,4)) || '-' || upper(substr(md5(random()::text),5,4)));
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

-- Storage buckets (public-read; object paths contain unguessable UUIDs)
insert into storage.buckets (id, name, public) values ('avatars','avatars',true), ('attachments','attachments',true)
  on conflict (id) do nothing;
create policy "public read media" on storage.objects for select using (bucket_id in ('avatars','attachments'));
create policy "signed-in upload media" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars','attachments'));
