"""Database tests: applies the migrations to a throwaway Postgres and checks the security rules and triggers.
   pip install pgserver psycopg2-binary   then   python3 supabase/tests/run.py
   Supabase specifics (auth schema, roles, storage) are imitated by stub.sql; citext is replaced by plain text."""
import glob, json, os, sys, tempfile, uuid
import pgserver, psycopg2

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
srv = pgserver.get_server(tempfile.mkdtemp(prefix="relaytest"), cleanup_mode="stop")
conn = psycopg2.connect(srv.get_uri())
conn.autocommit = True
cur = conn.cursor()
cur.execute(open(os.path.join(ROOT, "supabase/tests/stub.sql")).read())
for f in sorted(glob.glob(os.path.join(ROOT, "supabase/migrations/*.sql"))):
    cur.execute(open(f).read().replace("create extension if not exists citext;", ""))
conn.autocommit = False

passed = failed = 0
def check(name, ok, detail=""):
    global passed, failed
    if ok: passed += 1; print("PASS", name)
    else: failed += 1; print("FAIL", name, detail)

def q(uid, sql, params=None, role="authenticated", aal="aal1"):
    """Run SQL as a Supabase-style role. uid=None for anon."""
    c = conn.cursor()
    try:
        c.execute("reset role")
        claims = {"role": role, "aal": aal}
        if uid: claims["sub"] = uid
        c.execute("select set_config('request.jwt.claims',%s,false)", (json.dumps(claims),))
        c.execute(f"set role {role}")
        c.execute(sql, params)
        rows = c.fetchall() if c.description else []
        conn.commit(); return rows
    except Exception:
        conn.rollback(); raise
    finally:
        c = conn.cursor(); c.execute("reset role"); conn.commit()

def err(uid, sql, params=None, **kw):
    try: q(uid, sql, params, **kw); return None
    except psycopg2.Error as e: return str(e).strip().splitlines()[0]

def sup(sql, params=None):  # superuser, bypasses RLS
    c = conn.cursor()
    try:
        c.execute("reset role"); c.execute(sql, params)
        rows = c.fetchall() if c.description else []
        conn.commit(); return rows
    except Exception:
        conn.rollback(); raise

def svc(sql, params=None): return q(None, sql, params, role="service_role")

def mkuser(name):
    return str(sup("insert into auth.users(email) values(%s) returning id", (f"{name}@example.test",))[0][0])

A, B, C, ADM = (mkuser(n) for n in ("creator", "renter", "other", "admin"))
sup("update profiles set is_admin=true where id=%s", (ADM,))

# ---- accounts
check("signup trigger creates a profile with a valid handle", sup("select count(*) from profiles where id in (%s,%s)", (A, B))[0][0] == 2)
check("profile handle rule rejects bad handles", err(A, "update profiles set handle='X' where id=%s", (A,)) is not None)
check("user can edit own bio", err(B, "update profiles set bio='hi' where id=%s", (B,)) is None)
check("user cannot self-promote to admin", err(B, "update profiles set is_admin=true where id=%s", (B,)) is not None)
check("user cannot set own score or ban flag", err(B, "update profiles set relay_score=100 where id=%s", (B,)) is not None and err(B, "update profiles set is_banned=false where id=%s", (B,)) is not None)
q(B, "update profiles set bio='hacked' where id=%s", (A,))
check("user cannot edit another profile", sup("select bio from profiles where id=%s", (A,))[0][0] != "hacked")

# ---- bots
ins = "insert into bots(creator_id,slug,name,strategy,markets,price_cents,billing_period,listed) values(%s,%s,%s,'trend',%s,%s,'month',false) returning id"
BOT = str(q(A, ins, (A, "bot-" + uuid.uuid4().hex[:6], "Alpha Bot", ["BTC/USDT"], 0))[0][0])
VER = str(sup("insert into bot_versions(bot_id,version,code_sha256,storage_path) values(%s,1,'h','p') returning id", (BOT,))[0][0])
sup("update bots set current_version_id=%s where id=%s", (VER, BOT))
check("a creator cannot list a bot before its code has passed the checks", err(A, "update bots set listed=true where id=%s", (BOT,)) is not None)
svc("update bots set code_check='passed' where id=%s", (BOT,))
q(A, "update bots set listed=true where id=%s", (BOT,))
check("creator can list a bot once its code passed", sup("select listed from bots where id=%s", (BOT,))[0][0] is True)
check("unknown market rejected", err(A, ins, (A, "b2" + uuid.uuid4().hex[:5], "Bad Mkt", ["NOPE/USDT"], 0)) is not None)
check("duplicate markets rejected", err(A, ins, (A, "b3" + uuid.uuid4().hex[:5], "Dup Mkt", ["BTC/USDT", "BTC/USDT"], 0)) is not None)
check("more than 10 markets rejected", err(A, ins, (A, "b4" + uuid.uuid4().hex[:5], "Many Mkt", ["BTC/USDT"] * 11, 0)) is not None)
check("user cannot create a bot as someone else", err(B, ins, (A, "b5" + uuid.uuid4().hex[:5], "Spoof Bot", ["BTC/USDT"], 0)) is not None)
q(A, "update bots set verification='verified' where id=%s", (BOT,))
check("creator cannot self-assign Verified", sup("select verification from bots where id=%s", (BOT,))[0][0] == "none")
q(B, "update bots set name='Stolen' where id=%s", (BOT,))
check("other users cannot edit a bot", sup("select name from bots where id=%s", (BOT,))[0][0] == "Alpha Bot")
check("anyone can read the marketplace view", len(q(None, "select id from bot_cards", role="anon")) == 1)
check("bots table hides delisted bots from strangers", (sup("update bots set listed=false where id=%s", (BOT,)), len(q(C, "select id from bots where id=%s", (BOT,))) == 0)[1])
check("creator still sees own delisted bot", len(q(A, "select id from bots where id=%s", (BOT,))) == 1)
sup("update bots set listed=true where id=%s", (BOT,))
check("hourly rate limit blocks the 11th new bot", (lambda: [err(A, ins, (A, "rl" + uuid.uuid4().hex[:6], "Rate Bot", ["ETH/USDT"], 0)) for _ in range(9)] and err(A, ins, (A, "rl" + uuid.uuid4().hex[:6], "Rate Bot", ["ETH/USDT"], 0)) is not None)())

# ---- verification notifications
svc("update bots set verification='verified' where id=%s", (BOT,))
check("service role can mark a bot Verified", sup("select verification from bots where id=%s", (BOT,))[0][0] == "verified")
check("creator is notified of verification", len(q(A, "select id from notifications where kind='verification'")) >= 1)
check("other users cannot read my notifications", len(q(B, "select id from notifications where user_id=%s", (A,))) == 0)
check("anon cannot read notifications", len(q(None, "select id from notifications", role="anon")) == 0)
nid = q(A, "select id from notifications limit 1")[0][0]
check("notification can be marked read but not edited", err(A, "update notifications set read=true where id=%s", (nid,)) is None and err(A, "update notifications set body='x' where id=%s", (nid,)) is not None)

# ---- rentals
R = str(q(B, "insert into rentals(bot_id,renter_id) values(%s,%s) returning id", (BOT, B))[0][0])
check("renter can rent a free bot", R is not None)
check("creator cannot rent own bot", err(A, "insert into rentals(bot_id,renter_id) values(%s,%s)", (BOT, A)) is not None)
check("renter cannot rent on behalf of someone else", err(B, "insert into rentals(bot_id,renter_id) values(%s,%s)", (BOT, C)) is not None)
check("renter cannot forge live_state or price", err(B, "update rentals set live_state='{\"cash\":1e9}' where id=%s", (R,)) is not None and err(B, "update rentals set price_cents=0 where id=%s", (R,)) is not None)
check("renter can cancel a free rental", err(B, "update rentals set status='cancelled' where id=%s", (R,)) is None)
q(B, "update rentals set status='active' where id=%s", (R,))
check("other users cannot see my rentals", len(q(C, "select id from rentals")) == 0)
sup("update app_config set value='true' where key='payments_enabled'"); sup("update bots set price_cents=500 where id=%s", (BOT,))
check("paid bots cannot be rented without checkout", err(C, "insert into rentals(bot_id,renter_id) values(%s,%s)", (BOT, C)) is not None)
check("service role (webhook) can create the paid rental", err(None, "insert into rentals(bot_id,renter_id,stripe_subscription_id) values(%s,%s,'sub_1')", (BOT, C), role="service_role") is None)
check("paid rental status cannot be changed by the renter", err(C, "update rentals set status='cancelled' where renter_id=%s", (C,)) is not None)
sup("update app_config set value='false' where key='payments_enabled'"); sup("update bots set price_cents=0 where id=%s", (BOT,))

# ---- live trading gates
upd = "update rentals set connection_id=%s,allocation_usd=%s,live=true where id=%s"
CONN = str(sup("insert into exchange_connections(user_id,exchange,label,key_hint,api_key_enc,api_secret_enc) values(%s,'binance','t','abcd','x','y') returning id", (B,))[0][0])
check("live trading refused while the platform flag is off", "not enabled" in (err(B, upd, (CONN, 50, R)) or ""))
sup("update app_config set value='true' where key='live_execution_enabled'")
sup("update bots set verification='none' where id=%s", (BOT,))
check("live trading refused for an unverified bot", "verified" in (err(B, upd, (CONN, 50, R)) or ""))
sup("update bots set verification='verified' where id=%s", (BOT,))
check("allocation above the cap is refused", err(B, upd, (CONN, 5000, R)) is not None)
check("allocation below 10 is refused", err(B, upd, (CONN, 5, R)) is not None)
check("someone else's key cannot be used", err(C, "update rentals set connection_id=%s,allocation_usd=50,live=true where renter_id=%s", (CONN, C)) is not None)
sup("insert into auth.mfa_factors(user_id,status) values(%s,'verified')", (B,))
check("2FA users need an aal2 session to start live trading", err(B, upd, (CONN, 50, R), aal="aal1") is not None)
check("2FA users can start live trading with an aal2 session", err(B, upd, (CONN, 50, R), aal="aal2") is None)
sup("delete from auth.mfa_factors where user_id=%s", (B,))
check("allocation cannot change while live", err(B, "update rentals set allocation_usd=60 where id=%s", (R,)) is not None)
check("loss limits can change while live", err(B, "update rentals set max_daily_loss_pct=3,max_drawdown_pct=15,stop_loss_pct=5 where id=%s", (R,)) is None)
check("drawdown limit range enforced", err(B, "update rentals set max_drawdown_pct=1 where id=%s", (R,)) is not None)
check("key secrets are unreadable to the owner", err(B, "select api_key_enc from exchange_connections") is not None)
check("key labels are readable to the owner", len(q(B, "select id,label,key_hint from exchange_connections")) == 1)
check("others cannot see my keys", len(q(C, "select id from exchange_connections")) == 0)
check("clients cannot insert keys directly", err(B, "insert into exchange_connections(user_id,exchange,label,key_hint,api_key_enc,api_secret_enc) values(%s,'binance','z','1','x','y')", (B,)) is not None)
check("key cannot be deleted while a live rental uses it", err(B, "delete from exchange_connections where id=%s", (CONN,)) is not None)
svc("update rentals set live=false where id=%s", (R,))
svc("update rentals set live_state='{\"cash\":5,\"pos\":{\"BTC/USDT\":{\"qty\":0.2,\"avg\":1}}}' where id=%s", (R,))
check("key cannot be deleted while positions are still open", err(B, "delete from exchange_connections where id=%s", (CONN,)) is not None)
svc("update rentals set live_state='{\"cash\":5,\"pos\":{\"BTC/USDT\":{\"qty\":0,\"avg\":1}}}' where id=%s", (R,))
check("key can be deleted once flat and stopped", err(B, "delete from exchange_connections where id=%s", (CONN,)) is None)
sup("update app_config set value='false' where key='live_execution_enabled'")
sup("update app_config set value='true' where key='live_execution_enabled'")
svc("update rentals set connection_id=null,live=false where id=%s", (R,))
sup("update rentals set allocation_usd=50,connection_id=(select id from exchange_connections where user_id=%s limit 1) where id=%s", (B, R))
CONN2 = str(sup("insert into exchange_connections(user_id,exchange,label,key_hint,api_key_enc,api_secret_enc) values(%s,'binance','t2','efgh','x','y') returning id", (B,))[0][0])
svc("update rentals set connection_id=%s,allocation_usd=50,live=true where id=%s", (CONN2, R))
svc("update rentals set live=false,paused_reason='test stop' where id=%s", (R,))
sup("update app_config set value='false' where key='live_execution_enabled'")
check("live stop with a reason notifies the renter", len(q(B, "select id from notifications where kind='live'")) >= 1)

# ---- reviews
RV = "insert into reviews(bot_id,rental_id,reviewer_id,rating,body) values(%s,%s,%s,5,'great') returning id"
check("only renters can review", err(C, RV, (BOT, R, C)) is not None and err(A, RV, (BOT, R, A)) is not None)
sup("update app_config set value='7' where key='min_review_days'")
check("review waits for the minimum rental age", err(B, RV, (BOT, R, B)) is not None)
sup("update app_config set value='0' where key='min_review_days'")
RID = str(q(B, RV, (BOT, R, B))[0][0])
check("renter can review", RID is not None)
check("one review per rental", err(B, RV, (BOT, R, B)) is not None)
check("creator is notified of the review", len(q(A, "select id from notifications where kind='review'")) == 1)
q(B, "update reviews set reply='self' where id=%s", (RID,))
check("reviewer cannot write the creator reply", sup("select reply from reviews where id=%s", (RID,))[0][0] is None)
q(A, "update reviews set reply='thanks' where id=%s", (RID,))
check("creator can reply to a review", sup("select reply from reviews where id=%s", (RID,))[0][0] == "thanks")
q(A, "update reviews set body='rewritten',rating=1 where id=%s", (RID,))
check("creator cannot rewrite the review", sup("select body,rating from reviews where id=%s", (RID,))[0] == ("great", 5))
q(B, "update reviews set body='edited' where id=%s", (RID,))
check("reviewer can edit their own review", sup("select body from reviews where id=%s", (RID,))[0][0] == "edited")

# ---- social
P = "insert into posts(author_id,body,system) values(%s,%s,%s) returning id"
PID = str(q(B, P, (B, "hello", False))[0][0])
check("user can post", PID is not None)
check("clients cannot create system posts", err(B, P, (B, "fake", True)) is not None)
check("cannot post as someone else", err(B, P, (A, "spoof", False)) is not None)
check("comments work", err(C, "insert into comments(post_id,author_id,body) values(%s,%s,'hi')", (PID, C)) is None)
check("cannot comment as someone else", err(C, "insert into comments(post_id,author_id,body) values(%s,%s,'hi')", (PID, A)) is not None)
check("follow works, self-follow does not", err(B, "insert into follows values(%s,%s)", (B, A)) is None and err(B, "insert into follows values(%s,%s)", (B, B)) is not None)
check("cannot follow on someone else's behalf", err(B, "insert into follows(follower_id,followee_id) values(%s,%s)", (C, A)) is not None)
check("likes work", err(B, "insert into post_likes values(%s,%s)", (PID, B)) is None)
check("feed view shows like counts", q(None, "select likes from post_feed where id=%s", (PID,), role="anon")[0][0] == 1)
sup("update profiles set is_banned=true where id=%s", (C,))
check("banned users cannot post or comment", err(C, P, (C, "x", False)) is not None and err(C, "insert into comments(post_id,author_id,body) values(%s,%s,'x')", (PID, C)) is not None)
sup("update profiles set is_banned=false where id=%s", (C,))
for i in range(9): err(B, P, (B, f"spam{i}", False))
check("hourly rate limit blocks the 11th post", err(B, P, (B, "one too many", False)) is not None)

# ---- reports, support, admin
q(B, "insert into reports(reporter_id,target_type,target_id,reason) values(%s,'bot',%s,'bad')", (B, BOT))
check("reports are private to admins", len(q(A, "select id from reports")) == 0 and len(q(ADM, "select id from reports")) == 1)
q(B, "insert into support_tickets(user_id,subject,message) values(%s,'help me','please help')", (B,))
check("support tickets are private to the author and admins", len(q(A, "select id from support_tickets")) == 0 and len(q(B, "select id from support_tickets")) == 1 and len(q(ADM, "select id from support_tickets")) == 1)
check("non-admin cannot ban", err(B, "select admin_set_ban(%s,true)", (A,)) is not None)
check("admin can ban and it is logged", err(ADM, "select admin_set_ban(%s,true)", (C,)) is None and len(q(ADM, "select id from audit_log")) >= 1)
q(ADM, "select admin_set_ban(%s,false)", (C,))
check("admin flag allowlist", err(ADM, "select admin_set_flag('payments_enabled','true')") is not None and err(ADM, "select admin_set_flag('live_execution_enabled','false')") is None)
check("admin_stats works for admins only", q(ADM, "select admin_stats()")[0][0]["users"] >= 4 and err(B, "select admin_stats()") is not None)
check("non-admin cannot read the admin log or error log", len(q(B, "select id from audit_log")) == 0 and len(q(B, "select id from error_log")) == 0)
check("client error log accepts own client errors only", err(B, "insert into error_log(source,message,user_id) values('client','oops',%s)", (B,)) is None and err(B, "insert into error_log(source,message,user_id) values('worker','oops',%s)", (B,)) is not None)
sup("insert into code_flags(bot_id,other_bot_id,similarity) values(%s,%s,0.8)", (BOT, BOT))
check("code flags are admin-only", len(q(B, "select id from code_flags")) == 0 and len(q(ADM, "select id from code_flags")) == 1)

# ---- worker support functions
check("claim_worker gives one worker the lock", svc("select claim_worker('w1',1800)")[0][0] is True and svc("select claim_worker('w2',1800)")[0][0] is False and svc("select claim_worker('w1',1800)")[0][0] is True)
sup("update worker_lock set beat=now()-interval '2 hours'")
check("a stale lock can be taken over", svc("select claim_worker('w2',1800)")[0][0] is True)
check("clients cannot call claim_worker or refresh_scores", err(B, "select claim_worker('x',1)") is not None and err(B, "select refresh_scores()") is not None)
check("refresh_scores sets a creator score", (svc("select refresh_scores()"), 0 <= sup("select relay_score from profiles where id=%s", (A,))[0][0] <= 100)[1])
check("my_bot_rentals counts renters", q(A, "select active from my_bot_rentals() where bot_id=%s", (BOT,))[0][0] >= 1)

# ---- backtests, runs, equity, fills
sup("update bots set created_at=now()-interval '2 hours'")
CB = sup("insert into bots(creator_id,slug,name,strategy,markets,price_cents,billing_period,listed) values(%s,'nocode','No code','trend',array['BTC/USDT'],0,'month',false) returning id", (A,))[0][0]
BT = "insert into backtests(bot_id,creator_id,days) values(%s,%s,30)"
check("backtest needs uploaded code", err(A, BT, (CB, A)) is not None)
check("creator can queue a backtest", err(A, BT, (BOT, A)) is None)
check("others cannot queue or read backtests", err(B, BT, (BOT, B)) is not None and len(q(B, "select id from backtests")) == 0)
check("clients cannot edit backtest results", err(A, "update backtests set state='done'") is not None)
sup("insert into verification_runs(bot_id,version_id) values(%s,%s)", (BOT, VER))
check("only one active run per bot", err(None, "insert into verification_runs(bot_id,version_id) values(%s,%s)", (BOT, VER), role="service_role") is not None)
check("run details are private to the creator", len(q(A, "select id from verification_runs")) == 1 and len(q(B, "select id from verification_runs")) == 0)
sup("insert into equity_snapshots(bot_id,run_id,ts,equity) select %s,id,now(),10000 from verification_runs limit 1", (BOT,))
check("equity history is public for listed bots", len(q(None, "select * from equity_snapshots", role="anon")) == 1)
check("marketplace view carries a sparkline for bots with history", q(None, "select spark from bot_cards where id=%s", (BOT,), role="anon")[0][0] is not None)
sup("insert into fills(bot_id,market,side,qty,price) values(%s,'BTC/USDT','buy',1,1)", (BOT,))
sup("insert into fills(bot_id,rental_id,market,side,qty,price) values(%s,%s,'BTC/USDT','buy',1,1)", (BOT, R))
check("fills: creator sees all, renter sees own rental only, strangers none",
      len(q(A, "select id from fills")) == 2 and len(q(B, "select id from fills")) == 1 and len(q(C, "select id from fills")) == 0)
check("clients cannot write fills", err(A, "insert into fills(bot_id,market,side,qty,price) values(%s,'BTC/USDT','buy',1,1)", (BOT,)) is not None)

# ---- config, markets, storage
check("config is readable, not writable by clients", len(q(None, "select * from app_config", role="anon")) > 0 and q(B, "update app_config set value='x' returning key") == [])
check("markets are public, not writable", len(q(None, "select symbol from markets", role="anon")) >= 3 and err(B, "insert into markets(symbol,base,quote) values('X/USDT','X','USDT')") is not None)
check("code bucket: write only inside your own folder", err(A, "insert into storage.objects(bucket_id,name) values('bot-code',%s)", (f"{A}/bot/x.py",)) is None and err(A, "insert into storage.objects(bucket_id,name) values('bot-code',%s)", (f"{B}/bot/x.py",)) is not None)
check("code bucket: read only your own files", len(q(A, "select id from storage.objects where bucket_id='bot-code'")) == 1 and len(q(B, "select id from storage.objects where bucket_id='bot-code'")) == 0)


# ---- code checks (0009)
check("new bots start with pending code checks", q(A, "select code_check from bots where id=%s", (CB,))[0][0] == "pending")
q(A, "update bots set code_check='passed', code_check_notes=array['x'] where id=%s", (CB,))
check("creators cannot award themselves a code-check pass", q(A, "select code_check,cardinality(code_check_notes) from bots where id=%s", (CB,))[0] == ("pending", 0))
svc("update bots set code_check='warned', code_check_notes=array['Rarely trades'] where id=%s", (BOT,))
check("the worker can set code-check results, shown on public cards", q(None, "select code_check,code_check_notes from bot_cards where id=%s", (BOT,), role="anon")[0] == ("warned", ["Rarely trades"]))
sup("insert into bot_versions(bot_id,version,code_sha256,storage_path,check_report) values(%s,9,'h','p','{\"findings\":[]}') ", (BOT,))
check("code-check reports are visible to the creator and admin, not to others", len(q(A, "select id from bot_versions where version=9")) == 1 and len(q(ADM, "select id from bot_versions where version=9")) == 1 and len(q(C, "select id from bot_versions where version=9")) == 0)
check("creators cannot edit check results on versions", q(A, "update bot_versions set check_state='passed' where version=9 returning id") == [] or err(A, "update bot_versions set check_state='passed' where version=9") is not None)
check("verification costs $5", q(None, "select value from app_config where key='verification_fee_cents'", role="anon")[0][0] == "500")

# ---- free paper run becomes the verification run when the creator pays
sup("update verification_runs set state='failed' where bot_id=%s and state in ('pending','running')", (BOT,))
sup("insert into verification_runs(bot_id,version_id,kind,state,starts_at,ends_at) values(%s,%s,'track','running',now()-interval '3 days',now()+interval '3650 days')", (BOT, VER))
check("start_verification_run is not callable by users", err(A, "select start_verification_run(%s,%s,0,null)", (BOT, VER)) is not None)
check("paying converts the running paper run instead of starting over", svc("select start_verification_run(%s,%s,500,null)", (BOT, VER))[0][0] == "converted"
      and sup("select kind,state::text,fee_cents from verification_runs where bot_id=%s and state='running'", (BOT,))[0] == ("verification", "running", 500))
check("the converted run keeps its start and ends 30 days after it", sup("select ends_at-starts_at from verification_runs where bot_id=%s and state='running'", (BOT,))[0][0].days == 30)
check("the bot shows verification running", sup("select verification::text from bots where id=%s", (BOT,))[0][0] == "running")
check("a second request while one is active is refused", svc("select start_verification_run(%s,%s,500,null)", (BOT, VER))[0][0] == "busy")
sup("update verification_runs set state='failed' where bot_id=%s and state='running'", (BOT,))
check("with no paper run a new verification run is queued", svc("select start_verification_run(%s,%s,0,null)", (BOT, VER))[0][0] == "queued")
check("public cards report where stats came from", q(None, "select stats_source from bot_cards limit 1", role="anon")[0][0] in ("paper", "verified", "live"))

# ---- no listing without code
check("a bot with no code cannot be created as listed", err(A, "insert into bots(creator_id,slug,name,strategy,markets,price_cents,billing_period) values(%s,'nocode2','x','trend',array['BTC/USDT'],0,'month')", (A,)) is not None)
check("a creator cannot list a bot that has no code", err(A, "update bots set listed=true where id=%s", (CB,)) is not None)
check("not even the worker can list a bot with no code", err(None, "update bots set listed=true where id=%s", (CB,), role="service_role") is not None)

# ---- deleting an account
sup("insert into payments(user_id,kind,amount_cents,provider,state) values(%s,'verification_fee',1500,'stripe','paid')", (B,))
sup("insert into reports(reporter_id,target_type,target_id,reason) values(%s,'bot',%s,'x')", (B, BOT))
check("deleting an account removes its data and keeps money records", err(None, "select 1") is None and (sup("delete from auth.users where id=%s", (B,)), sup("select count(*) from profiles where id=%s", (B,))[0][0] == 0 and sup("select count(*) from payments where user_id is null")[0][0] == 1)[1])

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)