-- The co-instructor role was never a different role: every permission check
-- read "instructor or co-instructor", the course owner is marked by who
-- created the course and not by which of the two they hold, and the only
-- thing that ever produced one was the LTI map's answer for a content
-- developer. Two names for one set of powers only asked a reader to guess
-- what the difference was, so there is one name now.
UPDATE `course_memberships` SET `role` = 'instructor' WHERE `role` = 'co_instructor';
