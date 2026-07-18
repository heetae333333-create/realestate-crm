-- Supabase SQL Editor에서 전체 실행하세요.
create extension if not exists pgcrypto;

create type public.member_status as enum ('pending','approved','rejected','suspended');
create type public.member_role as enum ('agent','admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null default '',
  office_name text not null default '',
  phone text,
  role public.member_role not null default 'agent',
  status public.member_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  original_owner_id uuid not null references public.profiles(id),
  name text not null,
  phone text,
  customer_type text not null check (customer_type in ('매수','매도','임차','임대')),
  preferred_area text,
  budget_max numeric,
  status text not null default '신규',
  next_contact_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  original_owner_id uuid not null references public.profiles(id),
  title text not null,
  transaction_type text not null check (transaction_type in ('매매','전세','월세')),
  property_type text not null,
  district text,
  address text,
  price numeric,
  monthly_rent numeric,
  area_m2 numeric,
  move_in_date date,
  status text not null default 'available' check (status in ('available','hold','complete')),
  is_public boolean not null default true,
  description text,
  last_confirmed_at date default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.transfer_logs (
  id uuid primary key default gen_random_uuid(),
  from_agent uuid not null references public.profiles(id),
  to_agent uuid not null references public.profiles(id),
  handled_by uuid not null references public.profiles(id),
  customer_count integer not null default 0,
  listing_count integer not null default 0,
  reason text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,email,full_name,office_name,phone)
  values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''),coalesce(new.raw_user_meta_data->>'office_name',''),new.raw_user_meta_data->>'phone');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.set_original_owner()
returns trigger language plpgsql as $$
begin
  if new.original_owner_id is null then new.original_owner_id:=new.owner_id; end if;
  new.updated_at:=now();
  return new;
end $$;
create trigger customers_owner_trigger before insert or update on public.customers for each row execute procedure public.set_original_owner();
create trigger listings_owner_trigger before insert or update on public.listings for each row execute procedure public.set_original_owner();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and status='approved');
$$;
create or replace function public.is_approved()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and status='approved');
$$;

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.listings enable row level security;
alter table public.transfer_logs enable row level security;

create policy "profile approved or self read" on public.profiles for select using (id=auth.uid() or public.is_approved() or public.is_admin());
-- 프로필은 auth 트리거가 생성합니다. 일반 사용자는 role/status를 직접 수정할 수 없습니다.
create policy "profile admin update" on public.profiles for update using (public.is_admin()) with check (public.is_admin());

create policy "customer owner or admin read" on public.customers for select using (owner_id=auth.uid() or public.is_admin());
create policy "customer owner insert" on public.customers for insert with check (owner_id=auth.uid() and public.is_approved());
create policy "customer owner or admin update" on public.customers for update using (owner_id=auth.uid() or public.is_admin()) with check (owner_id=auth.uid() or public.is_admin());
create policy "customer owner or admin delete" on public.customers for delete using (owner_id=auth.uid() or public.is_admin());

create policy "approved users read public listings" on public.listings for select using ((is_public and public.is_approved()) or owner_id=auth.uid() or public.is_admin());
create policy "listing owner insert" on public.listings for insert with check (owner_id=auth.uid() and public.is_approved());
create policy "listing owner or admin update" on public.listings for update using (owner_id=auth.uid() or public.is_admin()) with check (owner_id=auth.uid() or public.is_admin());
create policy "listing owner or admin delete" on public.listings for delete using (owner_id=auth.uid() or public.is_admin());

create policy "admin transfer logs" on public.transfer_logs for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.transfer_agent_assets(p_from uuid,p_to uuid,p_reason text,p_after_status text default 'suspended')
returns jsonb language plpgsql security definer set search_path=public as $$
declare c_count int; l_count int;
begin
  if not public.is_admin() then raise exception '관리자만 이관할 수 있습니다.'; end if;
  if p_from=p_to then raise exception '동일한 중개사에게 이관할 수 없습니다.'; end if;
  update public.customers set owner_id=p_to,updated_at=now() where owner_id=p_from; get diagnostics c_count=row_count;
  update public.listings set owner_id=p_to,updated_at=now() where owner_id=p_from; get diagnostics l_count=row_count;
  insert into public.transfer_logs(from_agent,to_agent,handled_by,customer_count,listing_count,reason) values(p_from,p_to,auth.uid(),c_count,l_count,p_reason);
  if p_after_status in ('approved','suspended') then update public.profiles set status=p_after_status::public.member_status,updated_at=now() where id=p_from; end if;
  return jsonb_build_object('customers',c_count,'listings',l_count);
end $$;

-- 최초 관리자 지정: 회원가입 후 아래 이메일을 실제 관리자 이메일로 바꿔 1회 실행
-- update public.profiles set role='admin', status='approved' where email='admin@example.com';
