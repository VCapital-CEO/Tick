import {createClient} from "@supabase/supabase-js";
import {spawn} from "node:child_process";
import {mkdtempSync,writeFileSync,rmSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {liveTick} from "./live.js";
import {BINANCE} from "./config.js";
import {step,metrics,CAPITAL} from "./engine.js";
import {processBacktests} from "./backtest.js";
import {processChecks} from "./checks.js";
import {sendEmails} from "./email.js";
import os from "node:os";
import {syncMarkets,loadMarkets,SIX_HOURS} from "./markets.js";
let sentry=null;
if(process.env.SENTRY_DSN){try{sentry=await import("@sentry/node");sentry.init({dsn:process.env.SENTRY_DSN})}catch{console.error("SENTRY_DSN is set but @sentry/node is not installed. Run: npm i @sentry/node")}}
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const HOUR=3600e3;
const SYM={},VOL={};let lastSync=0;
const cache=new Map();

async function candles(m){
 if(cache.has(m))return cache.get(m);
 await new Promise(r=>setTimeout(r,60));
 const r=await fetch(`${BINANCE}/api/v3/klines?symbol=${SYM[m]}&interval=1h&limit=500`);
 if(!r.ok)throw new Error("klines "+r.status);
 const k=(await r.json()).map(c=>({t:c[0],o:+c[1],h:+c[2],l:+c[3],c:+c[4],v:+c[5]})).filter(c=>c.t+HOUR<=Date.now());
 cache.set(m,k);return k}

function sandbox(dir,input,ms=20000,script=null){return new Promise((res,rej)=>{
 const name="relay-"+Math.random().toString(36).slice(2);
 const p=spawn("docker",["run","--rm","-i",...(process.env.SANDBOX_RUNTIME?["--runtime",process.env.SANDBOX_RUNTIME]:[]),"--ulimit","nofile=128","--ulimit","fsize=10000000","--name",name,"--network","none","--memory","256m","--memory-swap","256m","--cpus","0.5","--pids-limit","64","--read-only","--tmpfs","/tmp:size=16m","--cap-drop","ALL","--security-opt","no-new-privileges","--user","65534:65534",...(script?["--entrypoint","python"]:[]),"-v",`${dir}:/bot:ro`,"relay-sandbox",...(script?["/"+script]:[])]);
 let out="",err="";const kill=()=>spawn("docker",["kill",name]);
 const t=setTimeout(()=>{kill();rej(new Error("timeout"))},ms);
 p.stdout.on("data",d=>{out+=d;if(out.length>600000){kill()}});
 p.stderr.on("data",d=>{if(err.length<2000)err+=d});
 p.on("close",c=>{clearTimeout(t);if(c!==0)return rej(new Error(`bot exited ${c}: ${err.slice(0,300)}`));try{res(JSON.parse(out))}catch{rej(new Error("bad output"))}});
 p.stdin.on("error",()=>{});p.stdin.end(JSON.stringify(input))})}

async function load(run,days=90){
 const since=new Date(Date.now()-days*864e5).toISOString();
 const{data:eq}=await db.from("equity_snapshots").select("ts,equity").eq("run_id",run.id).gte("ts",since).order("ts");
 const{data:fl}=await db.from("fills").select("realized_pnl").eq("run_id",run.id).gte("ts",since);
 return{eq:eq??[],fl:fl??[]}}

// Stats are labelled by origin: "paper" (free run), "verified" (paper run of a bot that paid for verification).
// "live" is written only by the broker layer once a bot trades real money for a renter.
async function saveStats(run){
 const{data:cur}=await db.from("bot_stats").select("source").eq("bot_id",run.bot_id).maybeSingle();if(cur?.source==="live")return;
 const{eq,fl}=await load(run);if(eq.length<2)return;
 const{data:b}=await db.from("bots").select("verification").eq("id",run.bot_id).single();
 const m=metrics(eq,fl),days=Math.floor((Date.now()-new Date(run.starts_at))/864e5),source=run.kind==="verification"||b?.verification==="verified"?"verified":"paper";
 await db.from("bot_stats").upsert({bot_id:run.bot_id,ret_90d:m.ret,max_dd:m.dd,sharpe:m.sharpe,win_rate:m.win,trades:m.trades,days_live:days,source,updated_at:new Date()})}

async function finish(run,rules,reason){
 const{eq,fl}=await load(run,run.kind==="verification"?rules.days:90),m=eq.length>1?metrics(eq,fl):{ret:0,dd:0,sharpe:0,win:null,trades:fl.length},fails=[];
 if(reason)fails.push(reason);
 if(m.trades<rules.min_trades)fails.push(`trades ${m.trades} below ${rules.min_trades}`);
 if(m.dd>rules.max_dd_pct)fails.push(`drawdown ${m.dd.toFixed(1)}% above ${rules.max_dd_pct}%`);
 if(m.sharpe<rules.min_sharpe)fails.push(`sharpe ${m.sharpe.toFixed(2)} below ${rules.min_sharpe}`);
 const ok=!fails.length;
 await saveStats(run);
 if(run.kind==="track"){ // a free paper run ending never changes the bot's verification status
  await db.from("verification_runs").update({state:reason?"failed":"verified",result:{...m,reason:reason??null}}).eq("id",run.id);return}
 await db.from("verification_runs").update({state:ok?"verified":"failed",result:{...m,fails}}).eq("id",run.id);
 await db.from("bots").update({verification:ok?"verified":"failed"}).eq("id",run.bot_id);
 if(ok)await db.from("posts").insert({author_id:run.bots.creator_id,body:`${run.bots.name} passed verification.`,system:true})}

// A tracking run continues from the bot's last recorded equity so its chart stays continuous.
async function startCash(run){
 if(run.kind!=="track")return CAPITAL;
 const{data}=await db.from("equity_snapshots").select("equity").eq("bot_id",run.bot_id).order("ts",{ascending:false}).limit(1);
 return data?.[0]?+data[0].equity:CAPITAL}
async function processRun(run,rules){
 const now=new Date();
 if(run.state==="pending"){
  // A run only starts once the uploaded version has passed the code checks.
  const cs=run.bot_versions.check_state;if(cs==="pending"||cs==="running")return;
  if(cs==="failed"){await logErr("paid run blocked by failed code check, refund may be due",run.id);return finish(run,rules,"Code checks failed")}
  run.starts_at=now.toISOString();run.ends_at=new Date(+now+(run.kind==="track"?3650:rules.days)*864e5).toISOString();run.paper_state={cash:await startCash(run),pos:{},errors:0};
  await db.from("verification_runs").update({state:"running",starts_at:run.starts_at,ends_at:run.ends_at,paper_state:run.paper_state}).eq("id",run.id);
  if(run.kind!=="track")await db.from("bots").update({verification:"running"}).eq("id",run.bot_id)}
 if(now>=new Date(run.ends_at))return finish(run,rules);
 const mk=run.bots.markets.filter(m=>SYM[m]).slice(0,10);
 if(!mk.length)return finish(run,rules,"No supported markets");
 const slot=new Date(Math.floor(+now/HOUR)*HOUR).toISOString();
 const{data:have}=await db.from("equity_snapshots").select("ts").eq("run_id",run.id).eq("ts",slot);
 if(have?.length)return;
 const dir=mkdtempSync(join(tmpdir(),"relay-"));
 try{
  const{data:blob,error}=await db.storage.from("bot-code").download(run.bot_versions.storage_path);
  if(error)throw new Error("code download failed");
  writeFileSync(join(dir,"bot.py"),Buffer.from(await blob.arrayBuffer()),{mode:0o644});chmodSync(dir,0o755);
  const cs={},prices={};for(const m of mk){cs[m]=await candles(m);prices[m]=cs[m].at(-1).c}
  const st=run.paper_state;let targets={};
  try{const o=await sandbox(dir,{markets:mk,candles:cs,state:st.bot_state||{}});targets=o.targets;if(JSON.stringify(o.state||{}).length<16000)st.bot_state=o.state;st.errors=0}
  catch(e){st.errors=(st.errors??0)+1;console.error(run.id,e.message);
   if(st.errors>=5){await db.from("verification_runs").update({paper_state:st}).eq("id",run.id);return finish(run,rules,"Bot failed 5 runs in a row: "+e.message)}}
  const{fills,equity}=step(st,prices,targets,VOL);
  if(fills.length)await db.from("fills").insert(fills.map(f=>({...f,bot_id:run.bot_id,run_id:run.id,ts:now})));
  await db.from("equity_snapshots").insert({bot_id:run.bot_id,run_id:run.id,ts:slot,equity});
  await db.from("verification_runs").update({paper_state:st}).eq("id",run.id);
  await saveStats(run)
 }finally{rmSync(dir,{recursive:true,force:true})}}

async function logErr(msg,detail){console.error(msg,detail||"");try{sentry?.captureMessage(`${msg} ${detail||""}`.slice(0,500),"error")}catch{}try{await db.from("error_log").insert({source:"worker",message:String(msg).slice(0,500),detail:detail?String(detail).slice(0,2000):null})}catch{}}
// Every listed bot whose code passed the checks gets a free, continuous paper run on its current version.
async function ensureTrack(){
 const{data:bs}=await db.from("bots").select("id,current_version_id").eq("listed",true).in("code_check",["passed","warned"]).not("current_version_id","is",null);if(!bs?.length)return;
 const ids=bs.map(b=>b.id),{data:act}=await db.from("verification_runs").select("bot_id").in("bot_id",ids).in("state",["pending","running"]),have=new Set((act??[]).map(a=>a.bot_id));
 const{data:bad}=await db.from("verification_runs").select("bot_id,version_id").in("bot_id",ids).eq("kind","track").eq("state","failed"),dead=new Set((bad??[]).map(x=>x.bot_id+x.version_id));
 for(const b of bs){if(have.has(b.id)||dead.has(b.id+b.current_version_id))continue;
  await db.from("verification_runs").insert({bot_id:b.id,version_id:b.current_version_id,kind:"track"})}}
let lastPrune=0;
async function prune(){
 if(Date.now()-lastPrune<864e5)return;lastPrune=Date.now();
 const cut=new Date(Date.now()-120*864e5).toISOString();
 await db.from("equity_snapshots").delete().lt("ts",cut);
 await db.from("fills").delete().lt("ts",cut).not("run_id","is",null);
 await db.from("error_log").delete().lt("created_at",new Date(Date.now()-30*864e5).toISOString())}

let haveLock=false,chkBusy=false;
// Code checks run on their own 5-second loop so an upload sees its progress quickly (only while this worker holds the lock).
setInterval(async()=>{if(!haveLock||chkBusy||!Object.keys(SYM).length)return;chkBusy=true;try{await processChecks(db,{sandbox,SYM,VOL,logErr})}catch(e){await logErr("code check",e.message)}finally{chkBusy=false}},5000);
async function tick(){
 const{data:got,error:ce}=await db.rpc("claim_worker",{p_id:process.env.WORKER_ID||os.hostname(),p_ttl:Math.max(1800,Math.round((Number(process.env.TICK_MS)||600e3)/1000*3))});
 if(ce)throw ce;haveLock=!!got;if(!got){console.log("Another worker holds the lock");return}
 cache.clear();
 const{data:cfg}=await db.from("app_config").select("*");
 const c=Object.fromEntries((cfg??[]).map(r=>[r.key,r.value])),rules=JSON.parse(c.verification_rules);
 if(Date.now()-lastSync>SIX_HOURS){try{console.log("synced",await syncMarkets(db,Number(process.env.MIN_VOLUME_USD??c.min_market_volume_usd??1e6)),"markets");lastSync=Date.now()}catch(e){await logErr("market sync",e.message+(e.cause?` (${e.cause.code||e.cause.message})`:""))}}
 await loadMarkets(db,SYM,VOL);
 const{data:runs}=await db.from("verification_runs").select("*,bots(id,name,creator_id,markets),bot_versions(storage_path,check_state)").in("state",["pending","running"]);
 for(const r of runs??[]){try{await processRun(r,rules)}catch(e){await logErr("run "+r.id,e.message)}}
 try{await liveTick(db,{SYM,candles,sandbox,log:logErr,halt:c.live_execution_enabled!=="true"})}catch(e){await logErr("liveTick",e.message)}
  for(const f of[ensureTrack,()=>processBacktests(db,{sandbox,SYM,VOL}),()=>sendEmails(db),prune]){try{await f()}catch(e){await logErr("task",e.message)}}
 await db.rpc("refresh_scores");
 console.log(new Date().toISOString(),"tick",runs?.length??0,"runs")}

try{const ip=(await(await fetch("https://api.ipify.org?format=json")).json()).ip;await db.from("app_config").upsert({key:"worker_ip",value:ip})}catch{}
if(process.env.RUN_ONCE){
 // Scheduled mode (GitHub Actions): one tick, then keep serving code checks until the time budget ends, then exit.
 await tick();
 const end=Date.now()+(Number(process.env.RUN_SECONDS)||240)*1000;
 while(Date.now()<end)await new Promise(r=>setTimeout(r,2000));
 for(let i=0;chkBusy&&i<90;i++)await new Promise(r=>setTimeout(r,2000));
 process.exit(0)}
await tick();setInterval(()=>tick().catch(e=>console.error(e)),Number(process.env.TICK_MS)||10*60e3);