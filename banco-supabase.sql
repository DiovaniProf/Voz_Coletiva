-- PARTICIPA AO VIVO — banco para GitHub Pages + Supabase (modo on-line)
-- Execute uma única vez no SQL Editor de um projeto Supabase novo.
-- Código de seis dígitos identifica a sala; token secreto autoriza controles do apresentador.
-- ATENÇÃO: não aplique este script em um banco de produção já existente sem revisão.

create table if not exists public.participa_rooms (
  code text primary key check (code ~ '^[0-9]{6}$'),
  title text not null,
  host_token uuid not null,
  pin_hash text not null,
  active_id uuid,
  created_at timestamptz not null default now()
);
create table if not exists public.participa_slides (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.participa_rooms(code) on delete cascade,
  pos integer not null,
  type text not null check (type in ('cloud','poll','quiz','open')),
  question text not null,
  options jsonb not null default '[]'::jsonb,
  correct_index integer,
  locked boolean not null default false,
  reveal boolean not null default false,
  epoch integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists public.participa_participants (
  room_code text not null references public.participa_rooms(code) on delete cascade,
  participant_id text not null,
  joined_at timestamptz not null default now(),
  primary key(room_code, participant_id)
);
create table if not exists public.participa_answers (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.participa_rooms(code) on delete cascade,
  slide_id uuid not null references public.participa_slides(id) on delete cascade,
  participant_id text not null,
  value_text text,
  value_index integer,
  epoch integer not null,
  created_at timestamptz not null default now()
);
create index if not exists participa_slides_room_idx on public.participa_slides(room_code, pos);
create index if not exists participa_answers_slide_idx on public.participa_answers(slide_id, epoch);

-- Tabelas inacessíveis diretamente pelo frontend. Somente as RPCs abaixo fornecem dados.
alter table public.participa_rooms enable row level security;
alter table public.participa_slides enable row level security;
alter table public.participa_participants enable row level security;
alter table public.participa_answers enable row level security;
revoke all on public.participa_rooms, public.participa_slides, public.participa_participants, public.participa_answers from anon, authenticated;

create or replace function public.participa_room_state(p_code text, p_token text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.participa_rooms%rowtype;
  s public.participa_slides%rowtype;
  is_host boolean;
  participant_count integer;
  answer_count integer;
  slide_json jsonb;
  slide_list jsonb := '[]'::jsonb;
  response_json jsonb;
begin
  select * into r from public.participa_rooms where code=p_code;
  if not found then raise exception 'Sala não encontrada.'; end if;
  is_host := (p_token is not null and r.host_token::text = p_token);
  select count(*) into participant_count from public.participa_participants where room_code=p_code;
  for s in select * from public.participa_slides
    where room_code=p_code and (is_host or id=r.active_id) order by pos, created_at loop
    select count(*) into answer_count from public.participa_answers a where a.slide_id=s.id and a.epoch=s.epoch;
    slide_json := pg_catalog.jsonb_build_object('id',s.id::text,'type',s.type,'question',s.question,
      'options',s.options,'locked',s.locked,'reveal',s.reveal,'total',answer_count,'epoch',s.epoch);
    if is_host then
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id',a.id::text,'participantId',a.participant_id,
        'value',case when s.type in ('poll','quiz') then pg_catalog.to_jsonb(a.value_index) else pg_catalog.to_jsonb(a.value_text) end,
        'at',a.created_at) order by a.created_at),'[]'::jsonb)
      into response_json from public.participa_answers a where a.slide_id=s.id and a.epoch=s.epoch;
      slide_json := slide_json || pg_catalog.jsonb_build_object('answers',response_json,'correctIndex',s.correct_index);
    elsif s.type in ('poll','quiz') then
      select coalesce(pg_catalog.jsonb_agg((select count(*) from public.participa_answers a
        where a.slide_id=s.id and a.epoch=s.epoch and a.value_index=n.i) order by n.i),'[]'::jsonb)
      into response_json from pg_catalog.generate_series(0,pg_catalog.jsonb_array_length(s.options)-1) n(i);
      slide_json := slide_json || pg_catalog.jsonb_build_object('counts',response_json);
      if s.type='quiz' and s.reveal then
        slide_json := slide_json || pg_catalog.jsonb_build_object('correctIndex',s.correct_index);
      end if;
    elsif s.type='cloud' then
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('word',t.word,'count',t.ct)
        order by t.ct desc,t.word),'[]'::jsonb) into response_json
      from (select min(a.value_text) as word, count(*) as ct
        from public.participa_answers a where a.slide_id=s.id and a.epoch=s.epoch
        group by pg_catalog.lower(a.value_text) order by ct desc limit 120) t;
      slide_json := slide_json || pg_catalog.jsonb_build_object('words',response_json);
    else
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',a.id::text,'value',a.value_text)
        order by a.created_at),'[]'::jsonb) into response_json
      from public.participa_answers a where a.slide_id=s.id and a.epoch=s.epoch;
      slide_json := slide_json || pg_catalog.jsonb_build_object('responses',response_json);
    end if;
    slide_list := slide_list || pg_catalog.jsonb_build_array(slide_json);
  end loop;
  return pg_catalog.jsonb_build_object('code',r.code,'title',r.title,'activeId',r.active_id::text,
    'attendees',participant_count,'slides',slide_list);
end;
$$;

create or replace function public.participa_create_room(p_title text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  code text;
  token uuid := pg_catalog.gen_random_uuid();
  j integer;
begin
  if pg_catalog.length(p_pin) < 4 or pg_catalog.length(p_pin) > 128 then
    raise exception 'O PIN deve ter entre 4 e 128 caracteres.';
  end if;
  for j in 1..60 loop
    code := (pg_catalog.floor(pg_catalog.random()*900000)+100000)::integer::text;
    if not exists(select 1 from public.participa_rooms where participa_rooms.code=code) then exit; end if;
  end loop;
  if exists(select 1 from public.participa_rooms where participa_rooms.code=code) then raise exception 'Tente criar a sala novamente.'; end if;
  insert into public.participa_rooms(code,title,host_token,pin_hash)
  values (code,pg_catalog.left(coalesce(nullif(pg_catalog.btrim(p_title),''),'Encontro interativo'),90),token,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_pin || ':' || token::text,'UTF8')),'hex'));
  return pg_catalog.jsonb_build_object('code',code,'token',token::text);
end;
$$;

create or replace function public.participa_rejoin_room(p_code text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.participa_rooms%rowtype;
begin
  select * into r from public.participa_rooms where code=p_code;
  if not found or r.pin_hash <> pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_pin || ':' || r.host_token::text,'UTF8')),'hex') then
    raise exception 'PIN incorreto ou sala inexistente.';
  end if;
  return pg_catalog.jsonb_build_object('token',r.host_token::text);
end;
$$;

create or replace function public.participa_join_room(p_code text, p_participant text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.participa_rooms where code=p_code) then raise exception 'Sala não encontrada.'; end if;
  if pg_catalog.length(p_participant)<8 or pg_catalog.length(p_participant)>64 then raise exception 'Participante inválido.'; end if;
  insert into public.participa_participants(room_code,participant_id)
  values (p_code,p_participant) on conflict (room_code,participant_id) do nothing;
  return pg_catalog.jsonb_build_object('ok',true);
end;
$$;

create or replace function public.participa_host_action(p_code text, p_token text, p_action text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.participa_slides%rowtype;
  sid uuid;
  newactive uuid;
  typ text;
  question_text text;
  opts jsonb;
  correct_idx integer;
begin
  if not exists(select 1 from public.participa_rooms where code=p_code and host_token::text=p_token) then
    raise exception 'Acesso negado ao apresentador.';
  end if;
  if p_action='host:add-slide' then
    typ := p_payload->>'type';
    question_text := pg_catalog.left(pg_catalog.btrim(p_payload->>'question'),170);
    if typ not in ('cloud','poll','quiz','open') or pg_catalog.length(question_text)<5 then raise exception 'Pergunta inválida.'; end if;
    opts := case when typ in ('poll','quiz') then coalesce(p_payload->'options','[]'::jsonb) else '[]'::jsonb end;
    if pg_catalog.jsonb_typeof(opts)<>'array' then raise exception 'Alternativas inválidas.'; end if;
    if typ in ('poll','quiz') and (pg_catalog.jsonb_array_length(opts)<2 or pg_catalog.jsonb_array_length(opts)>6) then raise exception 'Informe de 2 a 6 alternativas.'; end if;
    correct_idx := case when typ='quiz' then (p_payload->>'correctIndex')::integer else null end;
    if typ='quiz' and (correct_idx is null or correct_idx<0 or correct_idx>=pg_catalog.jsonb_array_length(opts)) then raise exception 'Gabarito inválido.'; end if;
    insert into public.participa_slides(room_code,pos,type,question,options,correct_index)
    values(p_code,(select coalesce(max(pos),0)+1 from public.participa_slides where room_code=p_code),typ,question_text,opts,correct_idx)
    returning id into sid;
    update public.participa_rooms set active_id=sid where code=p_code and active_id is null;
    return pg_catalog.jsonb_build_object('ok',true);
  end if;
  sid := (p_payload->>'slideId')::uuid;
  select * into s from public.participa_slides where id=sid and room_code=p_code;
  if not found then raise exception 'Atividade não encontrada.'; end if;
  if p_action='host:activate' then
    update public.participa_rooms set active_id=sid where code=p_code;
  elsif p_action='host:lock' then
    update public.participa_slides set locked=(p_payload->>'locked')::boolean where id=sid;
  elsif p_action='host:reveal' then
    if s.type<>'quiz' then raise exception 'Esta atividade não é um quiz.'; end if;
    update public.participa_slides set reveal=(p_payload->>'reveal')::boolean where id=sid;
  elsif p_action='host:clear' then
    delete from public.participa_answers where slide_id=sid;
    update public.participa_slides set epoch=epoch+1,reveal=false where id=sid;
  elsif p_action='host:delete' then
    select id into newactive from public.participa_slides where room_code=p_code and id<>sid order by pos limit 1;
    update public.participa_rooms set active_id=newactive where code=p_code and active_id=sid;
    delete from public.participa_slides where id=sid;
  elsif p_action='host:remove-answer' then
    delete from public.participa_answers where id=(p_payload->>'answerId')::uuid and slide_id=sid;
  else
    raise exception 'Ação não reconhecida.';
  end if;
  return pg_catalog.jsonb_build_object('ok',true);
end;
$$;

create or replace function public.participa_submit_answer(p_code text, p_participant text, p_slide uuid, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.participa_slides%rowtype;
  val text;
  idx integer;
  previous integer;
begin
  if not exists(select 1 from public.participa_participants where room_code=p_code and participant_id=p_participant) then
    raise exception 'Entre na sala antes de responder.';
  end if;
  select * into s from public.participa_slides where id=p_slide and room_code=p_code and not locked
    and id=(select active_id from public.participa_rooms where code=p_code) for update;
  if not found then raise exception 'Atividade não está recebendo respostas.'; end if;
  select count(*) into previous from public.participa_answers where slide_id=p_slide and epoch=s.epoch and participant_id=p_participant;
  if s.type in ('poll','quiz') then
    if previous>0 then raise exception 'Você já enviou seu voto.'; end if;
    if pg_catalog.jsonb_typeof(p_value)<>'number' then raise exception 'Alternativa inválida.'; end if;
    idx := (p_value #>> '{}')::integer;
    if idx<0 or idx>=pg_catalog.jsonb_array_length(s.options) then raise exception 'Alternativa inválida.'; end if;
    insert into public.participa_answers(room_code,slide_id,participant_id,value_index,epoch)
    values(p_code,p_slide,p_participant,idx,s.epoch);
  else
    val := pg_catalog.btrim(p_value #>> '{}');
    if s.type='cloud' then
      val := pg_catalog.left(val,38);
      if pg_catalog.length(val)<2 or previous>=3 then raise exception 'Palavra inválida ou limite atingido.'; end if;
      if exists(select 1 from public.participa_answers where slide_id=p_slide and epoch=s.epoch
        and participant_id=p_participant and pg_catalog.lower(value_text)=pg_catalog.lower(val)) then
        raise exception 'Você já enviou esta palavra.';
      end if;
    else
      val := pg_catalog.left(val,240);
      if pg_catalog.length(val)<2 or previous>0 then raise exception 'Resposta vazia ou já enviada.'; end if;
    end if;
    insert into public.participa_answers(room_code,slide_id,participant_id,value_text,epoch)
    values(p_code,p_slide,p_participant,val,s.epoch);
  end if;
  return pg_catalog.jsonb_build_object('ok',true);
end;
$$;

-- RPCs públicas são controladas por PIN/token e validação no servidor.
revoke all on function public.participa_room_state(text,text) from public;
revoke all on function public.participa_create_room(text,text) from public;
revoke all on function public.participa_rejoin_room(text,text) from public;
revoke all on function public.participa_join_room(text,text) from public;
revoke all on function public.participa_host_action(text,text,text,jsonb) from public;
revoke all on function public.participa_submit_answer(text,text,uuid,jsonb) from public;
grant execute on function public.participa_room_state(text,text) to anon, authenticated;
grant execute on function public.participa_create_room(text,text) to anon, authenticated;
grant execute on function public.participa_rejoin_room(text,text) to anon, authenticated;
grant execute on function public.participa_join_room(text,text) to anon, authenticated;
grant execute on function public.participa_host_action(text,text,text,jsonb) to anon, authenticated;
grant execute on function public.participa_submit_answer(text,text,uuid,jsonb) to anon, authenticated;
