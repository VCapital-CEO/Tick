-- Upload progress: the worker reports which check stage a version is in, and a listing created through the
-- upload form stays unlisted until its code has passed the checks.
alter table bot_versions add column check_stage text;
alter table bots add column pending_listing boolean not null default false;