-- WP-11: board, ranking, realtime, category type-ahead.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Realtime. The board's live inventory is display-only (API-CONTRACT §4): a
-- client subscribes to changes on `drops` and renders quantity_remaining /
-- status, but a catch is decided solely by POST /v1/catches (Redis). RLS still
-- applies to realtime, so a subscriber sees only what drops_select allows
-- (live/gone drops publicly). Adding the table to the Supabase publication is
-- what makes the subscription possible.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table drops;

-- ---------------------------------------------------------------------------
-- Category type-ahead (API-CONTRACT §8). MUST run through tag_search_document so
-- the `tags_search` GIN index is used (WP-2 finding): PostgREST cannot express a
-- filter over a function-expression index, so the query lives in this function,
-- whose WHERE clause matches the index expression exactly. Leaves only; ranked
-- exact-prefix first, then label-match over synonym-match, then sort_order.
-- (Contract also mentions "drop volume in the active city" as a final tiebreak;
-- deferred — documented in the WP-11 build-plan notes.)
-- ---------------------------------------------------------------------------
create or replace function search_tags(q text, p_lane lane default null, p_limit int default 10)
returns table (id uuid, label text, group_label text, matched_on text)
language sql stable as $$
  select t.id,
         t.label,
         g.label as group_label,
         case when to_tsvector('simple', t.label) @@ plainto_tsquery('simple', q)
              then 'label' else 'synonym' end as matched_on
  from tags t
  join tags g on g.id = t.parent_id                 -- leaves have a parent group
  where t.active
    and t.parent_id is not null                     -- leaves only, never groups
    and (p_lane is null or t.lanes @> array[p_lane]::lane[])
    and tag_search_document(t.label, t.synonyms) @@ plainto_tsquery('simple', q)
  order by (lower(t.label) like lower(q) || '%') desc,
           (case when to_tsvector('simple', t.label) @@ plainto_tsquery('simple', q) then 0 else 1 end),
           t.sort_order, t.label
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function search_tags(text, lane, int) from public;
grant execute on function search_tags(text, lane, int) to anon, authenticated, service_role;
