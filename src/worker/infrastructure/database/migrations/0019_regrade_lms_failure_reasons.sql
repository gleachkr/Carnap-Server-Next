-- Repairs 0017's backfill. That migration matched `last_error` with an
-- equality CASE over the eight sentences Carnap wrote *before* attempting a
-- delivery, and swept everything else into 'lms_rejected'. But four more of
-- those sentences were also Carnap's own prose rather than the platform's:
-- the token refusal, the unreadable token response, the unreachable-LMS
-- message (a prefix with a variable tail, which equality can never match),
-- and the bare message of any non-ScoreDeliveryError throw. Labelling those
-- 'lms_rejected' asserts the LMS rejected a grade it may never have seen,
-- and renders a translated sentence next to an English detail contradicting
-- it — the exact defect the reason codes exist to remove.
--
-- 0017 is not amended in place: it has already run (`d1_migrations` records
-- applied migrations by filename and never re-runs one), so an edit there
-- would fix new databases only and leave every migrated one wrong. The rows
-- it mislabelled kept their original text in `last_error`, so the mistake is
-- fully re-derivable here, and running after 0017 everywhere gives migrated
-- and fresh databases the same final state.
--
-- Scope: only rows 0017's `ELSE` could have produced — 'lms_rejected' with
-- surviving text. Failures recorded since the refactor are excluded by
-- shape: their detail is the platform's own `HTTP <status>[: body]`, which
-- no historical sentence begins with.
UPDATE `lti_grade_jobs`
SET `last_failure_reason` = CASE
    WHEN `last_error` LIKE
      'The LMS token endpoint refused the request (HTTP %'
      THEN 'lms_token_refused'
    WHEN `last_error` =
      'The LMS token endpoint returned an unreadable token response.'
      THEN 'lms_token_unreadable'
    WHEN `last_error` LIKE 'Could not reach the LMS: %'
      THEN 'lms_unreachable'
    WHEN `last_error` LIKE 'The LMS rejected the score (HTTP %'
      THEN 'lms_rejected'
    -- Written after the refactor; already correct in both columns.
    WHEN `last_error` LIKE 'HTTP %' THEN 'lms_rejected'
    -- An unrecognised string is a raw `error.message` from an unexpected
    -- throw. That is not evidence the LMS rejected anything, so it defaults
    -- to 'unexpected' rather than inventing a rejection.
    ELSE 'unexpected'
  END,
  -- `last_error` now means "what the LMS itself said". Keep the platform's
  -- half of the sentence, drop ours; where the sentence was ours entirely,
  -- leave nothing behind but the code.
  `last_error` = CASE
    WHEN `last_error` LIKE
      'The LMS token endpoint refused the request (HTTP %'
      THEN substr(
        `last_error`,
        length('The LMS token endpoint refused the request (') + 1,
        length(`last_error`)
          - length('The LMS token endpoint refused the request (')
          - length(').')
      )
    WHEN `last_error` LIKE 'The LMS rejected the score (HTTP %'
      THEN substr(
        `last_error`,
        length('The LMS rejected the score (') + 1,
        length(`last_error`)
          - length('The LMS rejected the score (')
          - length(').')
      )
    -- The tail here was the fetch layer's own message ("fetch failed"), which
    -- is what this case stores today.
    WHEN `last_error` LIKE 'Could not reach the LMS: %'
      THEN nullif(
        substr(`last_error`, length('Could not reach the LMS: ') + 1),
        ''
      )
    WHEN `last_error` LIKE 'HTTP %' THEN `last_error`
    ELSE NULL
  END
WHERE `last_failure_reason` = 'lms_rejected' AND `last_error` IS NOT NULL;
