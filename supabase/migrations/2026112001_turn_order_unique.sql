-- One position per turn within a session. The API computes order_index as latest + 1 and
-- retries on a unique violation, so concurrent writers can no longer share a position.
-- Idempotent: existing duplicates are renumbered (stable by order_index, then created_at, then id)
-- before the index is created.
with ranked as (
  select id,
         row_number() over (partition by session_id order by order_index, created_at, id) as rn
  from turns
)
update turns t
set order_index = ranked.rn
from ranked
where t.id = ranked.id
  and t.order_index is distinct from ranked.rn
  and exists (
    select 1 from turns d
    where d.session_id = t.session_id
    group by d.session_id, d.order_index
    having count(*) > 1
  );

create unique index if not exists turns_session_order_idx on turns(session_id, order_index);
