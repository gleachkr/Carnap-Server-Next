-- Why a revision was made, in the author's own words. A revision was only ever
-- identifiable by its ordinal, which says nothing about what changed; the
-- library now lists these notes and the assignment pickers label options with
-- them, so the number no longer reaches a reader at all.
--
-- Empty string rather than nullable, matching `assignment_content_versions`.`note`
-- and `assignment_exercise_excuses`.`reason`: "not written" and "written as
-- nothing" are the same state here, and only one of them needs representing.
-- Every revision that exists today gets it, which is honest — nobody was asked.
ALTER TABLE `content_revisions` ADD `details` text DEFAULT '' NOT NULL;
