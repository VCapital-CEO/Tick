// Renders every screen in a simulated browser against a fake Supabase client and fails on any script error.
import test,{afterEach} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";

const ROOT=new URL("../public/",import.meta.url);
const html=readFileSync(new URL("index.html",ROOT),"utf8").replace(/<script[\s\S]*?<\/script>/g,"");
const appJs=readFileSync(new URL("app.js",ROOT),"utf8");

const wins=[];afterEach(()=>{wins.splice(0).forEach(w=>w.close())});
const USER={id:"u-me",email:"me@example.test"};
const bot=(i,o={})=>({id:"b"+i,slug:"bot-"+i,name:"Bot "+i,description:"desc",strategy:"trend",markets:["BTC/USDT","ETH/USDT","SOL/USDT","DOGE/USDT","XRP/USDT"],price_cents:4900,billing_period:"month",verification:"verified",
 created_at:new Date().toISOString(),creator_id:i===1?"u-me":"u-other",creator_handle:i===1?"me_1":"other_1",creator_name:"Other",creator_color:"#123456",creator_score:80,
 ret_90d:12.3,max_dd:4.5,sharpe:1.2,win_rate:55,trades:40,days_live:35,avg_rating:4.5,review_count:2,...o});
const DATA={
 markets:[{symbol:"BTC/USDT",quote_volume_24h:1e9},{symbol:"ETH/USDT",quote_volume_24h:5e8}],
 bot_cards:[bot(1,{spark:[100,101,103,102,106,108,107,111]}),bot(2,{verification:"none",trades:0})],
 bots:[{id:"b1",slug:"bot-1",name:"Bot 1",description:"d",price_cents:4900,billing_period:"month",listed:true,verification:"verified",creator_id:"u-me"}],
 profiles:[{id:"u-me",handle:"me_1",display_name:"Me",bio:"hi",color:"#7c8cff",relay_score:77,is_admin:true,payouts_enabled:true,email_alerts:true,created_at:new Date().toISOString()}],
 reviews:[{id:"r1",bot_id:"b2",rating:5,body:"great",reply:null,reviewer_id:"u-me",created_at:new Date().toISOString(),profiles:{handle:"me_1"},bots:{name:"Bot 2",creator_id:"u-other"}}],
 app_config:[{key:"payments_enabled",value:"true"},{key:"live_execution_enabled",value:"true"},{key:"max_live_allocation_usd",value:"100"},{key:"worker_ip",value:"1.2.3.4"}],
 equity_snapshots:Array.from({length:30},(_,i)=>({ts:new Date(Date.now()-(30-i)*36e5).toISOString(),equity:10000+i*20-(i%7)*30})),
 fills:[{market:"BTC/USDT",side:"buy",qty:0.01,price:60000,realized_pnl:null,ts:new Date().toISOString(),rental_id:"rent1"},{market:"BTC/USDT",side:"sell",qty:0.01,price:61000,realized_pnl:9.5,ts:new Date().toISOString(),rental_id:"rent1"}],
 notifications:[{id:"n1",body:"Verification passed",link:"/bots/bot-1",read:false,created_at:new Date().toISOString()}],
 post_feed:[{id:"p1",body:"hello world",system:false,created_at:new Date().toISOString(),author_id:"u-other",handle:"other_1",display_name:"Other",color:"#abcdef",likes:2}],
 post_likes:[],follows:[],comments:[{id:"c1",post_id:"p1",body:"nice",created_at:new Date().toISOString(),profiles:{handle:"me_1"}}],
 bot_versions:[{bot_id:"b1",version:2}],verification_runs:[{bot_id:"b1",state:"running",ends_at:new Date(Date.now()+864e5).toISOString(),result:null,created_at:new Date().toISOString()}],
 bot_stats:[{bot_id:"b1",ret_90d:5,max_dd:2,trades:12}],
 backtests:[{id:"bt1",bot_id:"b1",state:"done",days:30,created_at:new Date().toISOString(),result:{days:30,ret:8,dd:3,sharpe:1.1,trades:20,consistent:false,halves:{first:{ret:9},second:{ret:-1}},equity:[100,101,103,102,105,104,108]}}],
 exchange_connections:[{id:"k1",label:"main",key_hint:"abcd",created_at:new Date().toISOString()}],
 rentals:[{id:"rent1",bot_id:"b2",renter_id:"u-me",status:"active",live:true,allocation_usd:50,max_daily_loss_pct:5,price_cents:4900,billing_period:"month",started_at:new Date().toISOString(),stripe_subscription_id:"sub_1",cancel_at_period_end:false,paused_reason:null,live_state:{cash:20,pos:{"BTC/USDT":{qty:0.001,avg:60000}}},bots:{name:"Bot 2",slug:"bot-2",verification:"verified"}}],
 support_tickets:[{id:"t1",subject:"help",message:"please",state:"open",created_at:new Date().toISOString()}],
 code_flags:[{id:"f1",bot_id:"b1",other_bot_id:"b2",similarity:0.82,a:{name:"Bot 1"},b:{name:"Bot 2"}}],
 error_log:[{source:"worker",message:"boom",detail:"d",created_at:new Date().toISOString()}],
 audit_log:[{action:"ban x",created_at:new Date().toISOString()}],
 reports:[{id:"rp1",target_type:"bot",target_id:"b2",reason:"bad",created_at:new Date().toISOString()}],
 posts:[{id:"p1",body:"hello world"}]};
const RPC={my_bot_rentals:[{bot_id:"b1",active:2,live:1}],admin_stats:{users:5,bots:2,live:1,beat:new Date().toISOString(),live_enabled:"true"}};

function builder(table,rpc){
 let single=false;
 const rows=()=>rpc?RPC[table]:(DATA[table]??[]);
 const b=new Proxy({},{get(_,k){
  if(k==="then")return(res,rej)=>{const d=rows(),out=single?(Array.isArray(d)?d[0]??null:d):d;return Promise.resolve({data:out,count:Array.isArray(d)?d.length:null,error:null}).then(res,rej)};
  if(k==="single"||k==="maybeSingle")return()=>{single=true;return b};
  return()=>b}});
 return b}
function makeClient(session){
 return{from:t=>builder(t),rpc:n=>builder(n,true),
  storage:{from:()=>({upload:async()=>({data:{},error:null})})},
  auth:{getSession:async()=>({data:{session}}),onAuthStateChange:cb=>{setTimeout(()=>cb("INITIAL_SESSION",session),0);return{data:{subscription:{}}}},
   signInWithPassword:async()=>({error:null}),signUp:async()=>({error:null}),signOut:async()=>({}),updateUser:async()=>({error:null}),resetPasswordForEmail:async()=>({error:null}),
   mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:"aal1",nextLevel:"aal1"}}),listFactors:async()=>({data:{totp:[]}}),enroll:async()=>({data:{id:"f",totp:{secret:"S",qr_code:"data:image/svg+xml;base64,AA=="}}}),challenge:async()=>({data:{id:"c"}}),verify:async()=>({error:null}),unenroll:async()=>({error:null})}}}}

async function boot(signedIn){
 const dom=new JSDOM(html,{url:"http://localhost/",runScripts:"outside-only",pretendToBeVisual:true}),w=dom.window,errors=[];wins.push(w);
 w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","")};w.HTMLDialogElement.prototype.close=function(){this.removeAttribute("open")};
 w.confirm=()=>true;w.prompt=()=>"text";w.scrollTo=()=>{};
 w.fetch=async()=>({ok:true,json:async()=>({checkout_url:"http://x",users:[],invoices:[],payouts:[],transactions:[],available:[],pending:[]})});
 w.CFG={url:"http://x.supabase.co",key:"anon",turnstileKey:""};
 w.supabase={createClient:()=>makeClient(signedIn?{user:USER,access_token:"t"}:null)};
 w.addEventListener("error",e=>errors.push(e.error?.message||e.message));
 const origErr=w.console.error;w.console.error=(...a)=>{errors.push(a.join(" "));origErr(...a)};
 w.eval(appJs);
 const wait=(ms=60)=>new Promise(r=>setTimeout(r,ms));await wait(100);
 const go=async h=>{w.location.hash=h;await wait(120)};
 return{w,errors,wait,go,$:s=>w.document.querySelector(s),view:()=>w.document.getElementById("view").textContent}}

test("marketplace renders cards, filters and the welcome dialog",async()=>{
 const t=await boot(false);await t.go("#/market");
 assert.equal(t.w.document.querySelectorAll(".card").length,2);assert.match(t.view(),/Bot 1/);assert.ok(t.$("#welcome").hasAttribute("open"));
 t.w.close();assert.deepEqual(t.errors,[])});

test("bot detail shows chart, trades, reviews, live panel and verification panel",async()=>{
 const t=await boot(true);await t.go("#/market");
 t.w.document.querySelectorAll(".card")[1].click();await t.wait(250);
 const d=t.$("#detailBody").textContent;assert.match(d,/Bot 2/);assert.match(d,/Reviews/);assert.match(d,/Live trading/);assert.ok(t.$("#eqChart svg"));assert.match(d,/Recent trades/);
 t.w.document.querySelector("#detail").removeAttribute("open");
 t.w.document.querySelectorAll(".card")[0].click();await t.wait(250);
 assert.match(t.$("#detailBody").textContent,/Verification/);t.w.close();assert.deepEqual(t.errors,[])});

test("feed, comments, creator dashboard, rentals, profile and admin render without errors",async()=>{
 const t=await boot(true);
 await t.go("#/feed");assert.match(t.view(),/hello world/);t.$("[data-cm]").click();await t.wait(100);assert.match(t.view(),/nice/);
 await t.go("#/creator");assert.match(t.view(),/My bots/);assert.match(t.view(),/Backtest/);assert.match(t.view(),/overfitting/);assert.match(t.view(),/Payouts are active/);
 await t.go("#/rentals");assert.match(t.view(),/Bot 2/);assert.match(t.view(),/Live/);assert.match(t.view(),/Exchange keys/);
 await t.go("#/me");assert.match(t.view(),/Relay score/);assert.match(t.view(),/Save profile/);
 await t.go("#/admin");assert.match(t.view(),/Moderation/);assert.match(t.view(),/Worker/);assert.match(t.view(),/Support tickets/);assert.match(t.view(),/Similar-code/);assert.match(t.view(),/boom/);
 t.w.close();assert.deepEqual(t.errors,[])});

test("settings, alerts and account dialogs work",async()=>{
 const t=await boot(true);
 t.$("#bellBtn").click();await t.wait(150);assert.match(t.$("#notifBody").textContent,/Verification passed/);
 t.$("#setBtn").click();await t.wait(150);assert.ok(t.$("#settings").hasAttribute("open"));assert.match(t.$("#mfaBox").textContent,/two-factor/i);
 t.w.close();assert.deepEqual(t.errors,[])});

test("signed-out visitors see sign-in prompts, not errors",async()=>{
 const t=await boot(false);
 for(const h of["#/creator","#/rentals","#/me","#/feed"]){await t.go(h)}
 assert.match(t.view(),/Sign in|Feed/);t.w.close();assert.deepEqual(t.errors,[])});

test("hero shows the featured verified record and rows show sparklines and the seal",async()=>{
 const t=await boot(false);await t.go("#/market");
 assert.ok(t.$("#heroProof .chart svg"),"hero chart missing");assert.match(t.$("#heroProof").textContent,/Bot 1/);
 assert.ok(t.$(".card .b-spark svg"),"row sparkline missing");assert.ok(t.$(".card .seal"),"verified seal missing");
 assert.match(t.$(".card:nth-child(2)").textContent,/No record yet/);
 t.$("#fVer").checked=true;t.$("#fVer").dispatchEvent(new t.w.Event("change"));await t.wait(120);
 assert.equal(t.errors.length,0);
 t.$("[data-open]").click();await t.wait(250);assert.ok(t.$("#detail").hasAttribute("open"));
 assert.match(t.$("#detailBody").textContent,/Drawdown/)});

test("community page shows the leaderboard and system posts",async()=>{
 const t=await boot(true);await t.go("#/feed");
 assert.match(t.view(),/Top creators/);assert.match(t.view(),/Community/);assert.equal(t.errors.length,0)});
