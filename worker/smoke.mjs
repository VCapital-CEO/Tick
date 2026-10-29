// End-to-end smoke test. Run from the worker folder with the worker running (TICK_MS=60000 recommended).
// Required env: SUPABASE_URL SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY
// Optional env for the live-trading part (Binance spot TESTNET keys only): TESTNET_KEY TESTNET_SECRET
import {createClient} from "@supabase/supabase-js";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
const {SUPABASE_URL:U,SUPABASE_ANON_KEY:ANON,SUPABASE_SERVICE_ROLE_KEY:SVC,TESTNET_KEY,TESTNET_SECRET}=process.env;
if(!U||!ANON||!SVC){console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY");process.exit(1)}
const svc=createClient(U,SVC,{auth:{persistSession:false}});
const VERIFY_MS=(+process.env.VERIFY_WAIT_MIN||15)*60e3,LIVE_MS=(+process.env.LIVE_WAIT_MIN||5)*60e3;
let failed=0,passed=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),must=(c,m)=>{if(!c)throw new Error(m)};
async function check(name,f){try{const r=await f();passed++;console.log("PASS",name);return r}catch(e){failed++;console.log("FAIL",name,"-",e.message||JSON.stringify(e))}}
async function waitFor(f,ms,every=5000){const end=Date.now()+ms;while(Date.now()<end){const v=await f();if(v)return v;await sleep(every)}return null}
async function mkUser(tag){
 const email=`smoke-${Date.now()}-${tag}@example.test`,password=randomUUID()+"Aa1";
 const{data,error}=await svc.auth.admin.createUser({email,password,email_confirm:true});if(error)throw error;
 const client=createClient(U,ANON,{auth:{persistSession:false}}),{data:s,error:e2}=await client.auth.signInWithPassword({email,password});if(e2)throw e2;
 return{id:data.user.id,client,jwt:s.session.access_token}}
async function fn(name,jwt,body){const r=await fetch(`${U}/functions/v1/${name}`,{method:"POST",headers:{"Content-Type":"application/json",apikey:ANON,Authorization:`Bearer ${jwt}`},body:JSON.stringify(body)});return{ok:r.ok,status:r.status,...(await r.json().catch(()=>({})))}}

const saved=Object.fromEntries(((await svc.from("app_config").select("*")).data??[]).map(r=>[r.key,r.value]));
let creator,renter,botId,rentalId,codePath;
try{
 await check("markets table has BTC/USDT (run the worker once first)",async()=>{const{data,error}=await svc.from("markets").select("symbol").eq("symbol","BTC/USDT").eq("tradable",true);if(error)throw error;must(data.length,"missing")});
 await check("create two test users and auto-created profiles",async()=>{[creator,renter]=await Promise.all([mkUser("c"),mkUser("r")]);
  const{data}=await svc.from("profiles").select("id").in("id",[creator.id,renter.id]);must(data.length===2,"profiles not created")});
 if(!creator||!renter)throw new Error("users missing, stopping");
 botId=await check("creator lists a bot",async()=>{const{data,error}=await creator.client.from("bots").insert({creator_id:creator.id,slug:"smoke-"+randomUUID().slice(0,8),name:"Smoke Test Bot",strategy:"other",markets:["BTC/USDT"],price_cents:0,billing_period:"month"}).select("id").single();if(error)throw error;return data.id});
 await check("unknown market is rejected",async()=>{const{error}=await creator.client.from("bots").insert({creator_id:creator.id,slug:"bad-"+randomUUID().slice(0,8),name:"Bad",strategy:"other",markets:["NOPE/USDT"],price_cents:0,billing_period:"month"});must(error,"accepted a fake market")});
 await check("creator cannot self-assign Verified",async()=>{await creator.client.from("bots").update({verification:"verified"}).eq("id",botId);const{data}=await svc.from("bots").select("verification").eq("id",botId).single();must(data.verification==="none","status changed to "+data.verification)});
 await check("upload and register bot code",async()=>{codePath=`${creator.id}/${botId}/${Date.now()}.py`;
  const{error}=await creator.client.storage.from("bot-code").upload(codePath,readFileSync(new URL("./examples/always_long.py",import.meta.url)),{contentType:"text/x-python"});if(error)throw error;
  const r=await fn("register-version",creator.jwt,{bot_id:botId,path:codePath});must(r.ok,r.error||r.status)});
 await check("another user cannot start verification on this bot",async()=>{const r=await fn("start-verification",renter.jwt,{bot_id:botId});must(!r.ok,"allowed")});
 await svc.from("app_config").update({value:JSON.stringify({days:0.005,min_trades:0,max_dd_pct:100,min_sharpe:-100})}).eq("key","verification_rules");
 await check("creator starts verification",async()=>{const r=await fn("start-verification",creator.jwt,{bot_id:botId});must(r.ok,r.error||r.status||"failed (is payments_enabled off?)")});
 const final=await waitFor(async()=>{const{data}=await svc.from("bots").select("verification").eq("id",botId).single();return["verified","failed"].includes(data.verification)?data.verification:null},VERIFY_MS);
 await check("worker completes verification (needs the worker running)",async()=>{must(final==="verified",final?`ended as ${final}`:"timed out; check worker logs")});
 await check("equity snapshots were recorded",async()=>{const{count}=await svc.from("equity_snapshots").select("*",{count:"exact",head:true}).eq("bot_id",botId);must(count>=1,"none")});
 await check("renter rents the bot",async()=>{const{data,error}=await renter.client.from("rentals").insert({bot_id:botId,renter_id:renter.id}).select("id").single();if(error)throw error;rentalId=data.id});
 await check("creator cannot rent own bot",async()=>{const{error}=await creator.client.from("rentals").insert({bot_id:botId,renter_id:creator.id});must(error,"allowed")});
 await check("renter cannot forge worker state",async()=>{const{error}=await renter.client.from("rentals").update({live_state:{cash:1e9}}).eq("id",rentalId);must(error,"allowed")});
 await check("live trading refused while the platform flag is off",async()=>{const{error}=await renter.client.from("rentals").update({live:true,allocation_usd:50}).eq("id",rentalId);must(error,"allowed")});
 await check("renter posts a review",async()=>{const{error}=await renter.client.from("reviews").insert({bot_id:botId,rental_id:rentalId,reviewer_id:renter.id,rating:5,body:"smoke test"});if(error)throw error});
 await check("posts and reports work, reports stay private",async()=>{
  let r=await renter.client.from("posts").insert({author_id:renter.id,body:"smoke test post"});if(r.error)throw r.error;
  r=await renter.client.from("reports").insert({reporter_id:renter.id,target_type:"bot",target_id:botId,reason:"smoke"});if(r.error)throw r.error;
  const{data}=await creator.client.from("reports").select("id");must(data.length===0,"non-admin can read reports")});
 await check("security: anon cannot read alerts; users cannot self-promote or edit others",async()=>{
  const anon=createClient(U,ANON,{auth:{persistSession:false}}),a=await anon.from("notifications").select("id");must(!a.data?.length,"anon read alerts");
  const e1=await renter.client.from("profiles").update({is_admin:true}).eq("id",renter.id);must(e1.error,"self-promotion allowed");
  await renter.client.from("profiles").update({bio:"hacked"}).eq("id",creator.id);
  const{data}=await svc.from("profiles").select("bio").eq("id",creator.id).single();must(data.bio!=="hacked","edited another profile")});
 await check("security: renter cannot read creator trade history or bot code versions",async()=>{
  const f=await renter.client.from("fills").select("id").eq("bot_id",botId),v=await renter.client.from("bot_versions").select("id").eq("bot_id",botId);
  must(!f.data?.length&&!v.data?.length,"readable")});
 await check("support tickets work and stay private",async()=>{
  const r=await renter.client.from("support_tickets").insert({user_id:renter.id,subject:"smoke test",message:"smoke test message"});if(r.error)throw r.error;
  const{data}=await creator.client.from("support_tickets").select("id");must(!data?.length,"another user can read tickets")});
 await check("comments work",async()=>{const p=await renter.client.from("posts").select("id").eq("author_id",renter.id).limit(1).single();
  const r=await creator.client.from("comments").insert({post_id:p.data.id,author_id:creator.id,body:"smoke comment"});if(r.error)throw r.error});
 await check("creator can reply to a review, reviewer cannot",async()=>{
  const{data:rv}=await svc.from("reviews").select("id").eq("bot_id",botId).single();
  await renter.client.from("reviews").update({reply:"self reply"}).eq("id",rv.id);
  let x=await svc.from("reviews").select("reply").eq("id",rv.id).single();must(!x.data.reply,"reviewer wrote a reply");
  const r=await creator.client.from("reviews").update({reply:"thanks"}).eq("id",rv.id);if(r.error)throw r.error;
  x=await svc.from("reviews").select("reply").eq("id",rv.id).single();must(x.data.reply==="thanks","creator reply did not save")});
 if(TESTNET_KEY&&TESTNET_SECRET&&final==="verified"){
  await check("save testnet key (needs BINANCE_TESTNET=true on the function)",async()=>{const r=await fn("exchange-keys",renter.jwt,{exchange:"binance",label:"testnet",api_key:TESTNET_KEY,api_secret:TESTNET_SECRET});must(r.ok,r.error||r.status)});
  await check("key secrets are not readable by the renter",async()=>{const{error}=await renter.client.from("exchange_connections").select("api_key_enc");must(error,"readable")});
  await svc.from("app_config").update({value:"true"}).eq("key","live_execution_enabled");
  const conn=(await renter.client.from("exchange_connections").select("id")).data?.[0];
  await check("renter starts live trading on testnet",async()=>{must(conn,"no key saved");const{error}=await renter.client.from("rentals").update({connection_id:conn.id,allocation_usd:100,max_daily_loss_pct:5,live:true}).eq("id",rentalId);if(error)throw error});
  await check("worker places a live testnet order",async()=>{const f=await waitFor(async()=>{const{data}=await svc.from("fills").select("id").eq("rental_id",rentalId);return data?.length?data:null},LIVE_MS);must(f,"no fill; check worker logs and that the worker uses BINANCE_BASE=https://testnet.binance.vision")});
  await renter.client.from("rentals").update({live:false}).eq("id",rentalId);
  await check("stopping live trading sells the position",async()=>{const ok=await waitFor(async()=>{const{data}=await svc.from("rentals").select("live_state").eq("id",rentalId).single();const p=data.live_state?.pos?.["BTC/USDT"];return!p||p.qty<0.0001},LIVE_MS);must(ok,"position still open")});
 }else console.log("SKIP live testnet checks (set TESTNET_KEY and TESTNET_SECRET, and the bot must verify first)");
}catch(e){failed++;console.log("STOPPED",e.message)}
finally{
 for(const k of["verification_rules","live_execution_enabled"])if(saved[k]!==undefined)await svc.from("app_config").update({value:saved[k]}).eq("key",k);
 if(codePath)await svc.storage.from("bot-code").remove([codePath]);
 for(const u of[creator,renter])if(u)await svc.auth.admin.deleteUser(u.id);
 console.log(`\n${passed} passed, ${failed} failed. Test users and config restored.`);process.exit(failed?1:0)}
