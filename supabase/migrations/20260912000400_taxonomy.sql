-- WP-2 / DATA-MODEL §5 taxonomy. Platform-controlled, two levels, no free text.

set search_path = public, extensions;

create table tags (
  id          uuid primary key default gen_random_uuid(),
  parent_id   uuid references tags(id),   -- null = top-level group
  slug        text unique not null,
  label       text not null,
  synonyms    text[] not null default '{}',
  lanes       lane[] not null default '{}',   -- empty on group rows
  selectable  boolean not null default true,  -- false on group rows
  active      boolean not null default true,
  sort_order  integer not null default 0,

  constraint groups_not_selectable
    check (parent_id is not null or selectable = false),
  constraint leaves_have_lanes
    check (parent_id is null or array_length(lanes, 1) >= 1)
);

create index on tags (parent_id) where active;
create index tags_lanes on tags using gin (lanes);
-- array_to_string() is only STABLE, and Postgres refuses non-IMMUTABLE
-- functions in index expressions (SQLSTATE 42P17). This wrapper is safe to
-- mark IMMUTABLE: for text[] with the 'simple' config the output depends on
-- nothing but its inputs. GET /v1/tags/search must query through it.
create or replace function tag_search_document(label text, synonyms text[])
returns tsvector
language sql immutable parallel safe as $$
  select to_tsvector('simple', label || ' ' || coalesce(array_to_string(synonyms, ' '), ''));
$$;

create index tags_search on tags using gin (tag_search_document(label, synonyms));

create table user_tags (
  user_id uuid not null references users(id) on delete cascade,
  tag_id  uuid not null references tags(id),
  primary key (user_id, tag_id)
);

create table org_tags (
  org_id uuid not null references organizations(id) on delete cascade,
  tag_id uuid not null references tags(id),
  primary key (org_id, tag_id)
);
