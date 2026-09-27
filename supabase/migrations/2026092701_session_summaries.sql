-- Council list summaries, computed in the database so the list request stays light:
-- one row per session with its persona reply count and who spoke, in speaking order.
create or replace function public.session_summaries(p_user_id uuid)
returns table (session_id uuid, turn_count integer, speakers text[])
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id as session_id,
    coalesce(count(t.id) filter (where t.persona <> 'User'), 0)::integer as turn_count,
    coalesce(
      (
        select array_agg(firsts.persona order by firsts.first_order)
        from (
          select t2.persona, min(t2.order_index) as first_order
          from turns t2
          where t2.session_id = s.id and t2.persona <> 'User'
          group by t2.persona
        ) as firsts
      ),
      '{}'::text[]
    ) as speakers
  from sessions s
  left join turns t on t.session_id = s.id
  where s.user_id = p_user_id
  group by s.id;
$$;

-- Only the API (service role) calls this; it filters by the signed-in user itself.
revoke all on function public.session_summaries(uuid) from public, anon, authenticated;
grant execute on function public.session_summaries(uuid) to service_role;
