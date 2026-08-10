-- Grade-passback failures recorded an English sentence in `last_error` and the
-- instructor panel rendered it verbatim. A failed job outlives the request that
-- wrote it, so the reason has to be resolvable into the reader's language at
-- render time: store a stable code, and keep `last_error` for the platform's
-- own free text (an HTTP status line, a rejection body).
ALTER TABLE `lti_grade_jobs` ADD `last_failure_reason` text;
--> statement-breakpoint
-- Backfill from the sentences we used to write. Each was a whole reason on its
-- own and carried no upstream detail, so the detail column is cleared for them.
UPDATE `lti_grade_jobs`
SET `last_failure_reason` = CASE `last_error`
    WHEN 'The LMS activity is no longer linked to an assignment.' THEN 'resource_link_unlinked'
    WHEN 'The LMS activity has no gradebook column (no AGS line item).' THEN 'line_item_missing'
    WHEN 'The linked assignment no longer exists.' THEN 'assignment_missing'
    WHEN 'The linked assignment is no longer graded.' THEN 'assignment_not_graded'
    WHEN 'The LMS registration for this activity no longer exists.' THEN 'platform_missing'
    WHEN 'The LMS connection is disabled.' THEN 'platform_disabled'
    WHEN 'The student is no longer linked to this LMS.' THEN 'student_unlinked'
    WHEN 'Unexpected delivery failure.' THEN 'unexpected'
    -- Anything else came from the LMS or the fetch layer; keep the text.
    ELSE 'lms_rejected'
  END,
  `last_error` = CASE
    WHEN `last_error` IN (
      'The LMS activity is no longer linked to an assignment.',
      'The LMS activity has no gradebook column (no AGS line item).',
      'The linked assignment no longer exists.',
      'The linked assignment is no longer graded.',
      'The LMS registration for this activity no longer exists.',
      'The LMS connection is disabled.',
      'The student is no longer linked to this LMS.',
      'Unexpected delivery failure.'
    ) THEN NULL
    ELSE `last_error`
  END
WHERE `last_error` IS NOT NULL;
