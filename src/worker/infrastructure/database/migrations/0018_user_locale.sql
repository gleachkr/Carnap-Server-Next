-- A user's chosen interface language, as a BCP-47 tag. Nullable with no
-- default: null means "no choice recorded", so the request's cookie or
-- Accept-Language decides. A stored default would be indistinguishable from
-- someone deliberately picking the default and would then survive every
-- change to what the default is.
ALTER TABLE `users` ADD `locale` text;
