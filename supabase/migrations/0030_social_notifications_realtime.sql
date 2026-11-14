-- Real-time notifications for social interactions. The trigger never notifies the actor about their own action.
create or replace function public.notify_social_interaction() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  actor uuid; target uuid; pid uuid; cid uuid; kind text; message text; link text;
begin
  actor := coalesce((to_jsonb(new)->>'user_id')::uuid,(to_jsonb(new)->>'author_id')::uuid,(to_jsonb(new)->>'follower_id')::uuid);
  if tg_table_name in ('post_likes','post_reposts','post_bookmarks','post_shares') then
    pid := (to_jsonb(new)->>'post_id')::uuid;
    select author_id into target from posts where id=pid;
    kind := case tg_table_name when 'post_likes' then 'like' when 'post_reposts' then 'repost' when 'post_bookmarks' then 'bookmark' else 'share' end;
    message := case kind when 'like' then 'Someone liked your post.' when 'repost' then 'Someone reposted your post.' when 'bookmark' then 'Someone bookmarked your post.' else 'Someone shared your post.' end;
    link := '/#/feed';
  elsif tg_table_name in ('comment_likes','comment_reposts') then
    cid := (to_jsonb(new)->>'comment_id')::uuid;
    select c.author_id,c.post_id into target,pid from comments c where c.id=cid;
    kind := case tg_table_name when 'comment_likes' then 'comment_like' else 'comment_repost' end;
    message := case kind when 'comment_like' then 'Someone liked your comment.' else 'Someone reposted your comment.' end;
    link := '/#/feed';
  elsif tg_table_name='comments' then
    actor := new.author_id; pid := new.post_id;
    select author_id into target from posts where id=pid;
    kind := case when new.parent_id is null then 'comment' else 'reply' end;
    message := case when new.parent_id is null then 'Someone commented on your post.' else 'Someone replied to your comment.' end;
    link := '/#/feed';
  elsif tg_table_name='follows' then
    actor := new.follower_id; target := new.followee_id; kind := 'follow'; message := 'Someone followed you.'; link := '/#/community';
  end if;
  if target is not null and actor is not null and target<>actor then
    perform public.notify(target,kind,message,link);
  end if;
  return new;
end $$;

drop trigger if exists social_notify_post_likes on post_likes;
create trigger social_notify_post_likes after insert on post_likes for each row execute function notify_social_interaction();
drop trigger if exists social_notify_post_reposts on post_reposts;
create trigger social_notify_post_reposts after insert on post_reposts for each row execute function notify_social_interaction();
drop trigger if exists social_notify_post_bookmarks on post_bookmarks;
create trigger social_notify_post_bookmarks after insert on post_bookmarks for each row execute function notify_social_interaction();
drop trigger if exists social_notify_post_shares on post_shares;
create trigger social_notify_post_shares after insert on post_shares for each row execute function notify_social_interaction();
drop trigger if exists social_notify_comment_likes on comment_likes;
create trigger social_notify_comment_likes after insert on comment_likes for each row execute function notify_social_interaction();
drop trigger if exists social_notify_comment_reposts on comment_reposts;
create trigger social_notify_comment_reposts after insert on comment_reposts for each row execute function notify_social_interaction();
drop trigger if exists social_notify_comments on comments;
create trigger social_notify_comments after insert on comments for each row execute function notify_social_interaction();
drop trigger if exists social_notify_follows on follows;
create trigger social_notify_follows after insert on follows for each row execute function notify_social_interaction();

-- Realtime publication is idempotent through guarded ALTER statements.
do $$ begin
  begin alter publication supabase_realtime add table notifications; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table comments; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table comment_likes; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table comment_reposts; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table post_likes; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table post_reposts; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table post_bookmarks; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table post_shares; exception when duplicate_object then null; end;
end $$;
notify pgrst,'reload schema';
