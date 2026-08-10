-- `assignment_content_versions`.`note` holds what the instructor wrote about a
-- correction. Publishing an assignment writes a version too, and had nothing to
-- put there, so it stored the sentence 'Initial published revision.' — a string
-- of ours sitting in a column of theirs. Two things went wrong with that. The
-- corrections ledger printed it as the author's own note, and it printed it in
-- English to every reader, since a stored sentence is past the point where
-- anything translates it. Publication is now said by position in the ledger,
-- which needs no words, and the publish writes an empty note.
--
-- Every row the publish has written to date carries the sentence, so they are
-- exactly recoverable, and blanking them gives migrated and fresh databases the
-- same final state. Scope is the literal text: an instructor who typed those
-- three words into a correction note themselves would lose them, which is a
-- price of one improbable sentence against the alternative of leaving every
-- assignment published so far misreporting its first version forever.
UPDATE `assignment_content_versions`
SET `note` = ''
WHERE `note` = 'Initial published revision.';
