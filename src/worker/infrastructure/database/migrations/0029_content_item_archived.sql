-- When an item was retired from its author's library, or null while it is in
-- use. The same column courses have, for the same reason: nothing deletes a
-- content item — assignments point at its revisions, and a revision may be
-- shared under an address somebody else has written down — so the way to make
-- last year's lesson stop crowding this year's list is a flag the library
-- reads and nothing else does.
--
-- Nullable and unset, because every item that exists when this runs is in use:
-- there was no way to say otherwise until now.
ALTER TABLE `content_items` ADD `archived_at` text;
