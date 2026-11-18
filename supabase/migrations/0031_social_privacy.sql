-- Bookmarks, post views and shares are private to the person who made them.
-- Public counts still work: post_feed is owned by the database owner, so its counts bypass these policies.
drop policy if exists bookmark_read on post_bookmarks;
create policy bookmark_read on post_bookmarks for select to authenticated using (user_id=auth.uid());
drop policy if exists impression_read on post_impressions;
create policy impression_read on post_impressions for select to authenticated using (user_id=auth.uid());
drop policy if exists share_read on post_shares;
create policy share_read on post_shares for select to authenticated using (user_id=auth.uid());
revoke select on post_bookmarks,post_impressions,post_shares from anon;