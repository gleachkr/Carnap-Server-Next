-- Writing content is now a permission rather than something every account can
-- do. Until today any signed-in person could create a content item and upload a
-- Markdown file into it, students included — which nobody asked for and which
-- puts file upload in the hands of the least trusted people on the platform.
--
-- Authoring now needs the `content_author` capability, `site_admin`, or an
-- active staff membership in some course (see `canAuthorContent`). The
-- membership arm covers instructors as they arrive, including the ones an LTI
-- launch creates without any capability grant at all; this backfill covers
-- everyone the membership arm does not, so that nobody who could author
-- yesterday finds themselves locked out this morning:
--
--   * holders of `course_creator` or `site_admin` — a course creator with no
--     course yet was still trusted to write;
--   * owners of a content item — they are authors by demonstration, whatever
--     they were granted.
--
-- The capability column has no CHECK constraint, so admitting a fourth value
-- needs no DDL.
--
-- `granted_by_id` is null because no administrator decided this; the migration
-- did, and the date is the trail back to here.
WITH authors AS (
  SELECT user_id AS user_id
    FROM platform_capability_grants
   WHERE revoked_at IS NULL
     AND capability IN ('course_creator', 'site_admin')
   UNION
  SELECT owner_user_id AS user_id
    FROM content_items
)
INSERT INTO platform_capability_grants (
  id,
  user_id,
  capability,
  granted_by_id,
  granted_at,
  revoked_at
)
SELECT
  -- A UUIDv7-shaped id, matching what `createAppId` writes. Each `randomblob`
  -- is re-evaluated per row, so the ids do not collide.
  lower(hex(randomblob(4)))
    || '-' || lower(hex(randomblob(2)))
    || '-7' || substr(lower(hex(randomblob(2))), 2)
    || '-8' || substr(lower(hex(randomblob(2))), 2)
    || '-' || lower(hex(randomblob(6))),
  authors.user_id,
  'content_author',
  NULL,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  NULL
FROM authors
WHERE NOT EXISTS (
  SELECT 1
    FROM platform_capability_grants existing
   WHERE existing.user_id = authors.user_id
     AND existing.capability = 'content_author'
     AND existing.revoked_at IS NULL
);
