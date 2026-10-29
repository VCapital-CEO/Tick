// Code checks for uploaded bot versions: static scan, behaviour probes, then a real-data backtest.
// A version with any "block" finding cannot be verified. "warn" findings are shown to the creator and renters.
import {mkdtempSync,writeFileSync,rmSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {simulate,history} from "./backtest.js";

const SHORT={ // short public labels for warnings (full text stays in the creator's report)
 "no-data":"Ignores market data","inactive":"Rarely trades","constant":"Constant output","churn":"Trades most hours","determinism":"Uses unseeded randomness",
 "price-levels":"Hard-coded price levels","dates":"Date-dependent decisions","timestamps":"Hard-coded dates","embedded-data":"Embedded data tables",
 "clock":"Reads the clock","range":"Exposure out of range","tail-risk":"Tail-risk profile","overfit":"Weak second half","few-trades":"Few trades","speed":"Slow","drawdown":"Deep drawdown","toplevel":"Runs code at import","mutable-default":"Mutable default"};

export function summarise(findings){
 const level=findings.some(f=>f.level==="block")?"failed":findings.some(f=>f.level==="warn")?"warned":"passed";
 const notes=[...new Set(findings.filter(f=>f.level==="warn").map(f=>SHORT[f.id]||f.id))].slice(0,6);
 return{state:level,notes}}

// Judges a real-data backtest result against the same rules the live verification uses.
export function judgeBacktest(r,rules){
 const f=[];
 if(r.trades===0)f.push({id:"inactive",level:"block",msg:"No trades at all in a 30-day backtest on real market data, so it cannot reach the verification minimum."});
 else if(r.trades<Math.min(15,rules.min_trades/2))f.push({id:"few-trades",level:"warn",msg:`Only ${r.trades} trades in 30 days; verification needs ${rules.min_trades}.`});
 if(r.trades>1800)f.push({id:"churn",level:"warn",msg:`${r.trades} trades in 30 days: fees and slippage will probably dominate.`});
 if(r.dd>rules.max_dd_pct)f.push({id:"drawdown",level:"warn",msg:`Backtest drawdown ${r.dd.toFixed(1)}% is above the ${rules.max_dd_pct}% verification limit.`});
 if(r.win!=null&&r.win>=85&&r.payoff!=null&&r.payoff<0.25)f.push({id:"tail-risk",level:"warn",msg:`${r.win.toFixed(0)}% winning trades but average loss is ${(1/Math.max(r.payoff,0.001)).toFixed(1)}x the average win: a pattern typical of strategies that hide rare large losses.`});
 if(r.consistent===false)f.push({id:"overfit",level:"warn",msg:"Performance collapsed in the second half of the period, a common sign of overfitting."});
 return f}

async function runIn(sandbox,dir,input,ms,script){
 const o=await sandbox(dir,input,ms,script);
 return Array.isArray(o.findings)?o:{findings:[{id:"analyser",level:"block",msg:"Check produced no result"}],metrics:{}}}

export async function checkVersion(db,v,{sandbox,SYM,VOL},rules){
 const stage=s=>db.from("bot_versions").update({check_stage:s}).eq("id",v.id).then(()=>{},()=>{});
 const dir=mkdtempSync(join(tmpdir(),"relay-chk-"));let findings=[],metrics={};
 const tag=(a,src)=>a.map(x=>({...x,source:src}));
 try{
  const{data:blob,error}=await db.storage.from("bot-code").download(v.storage_path);
  if(error){
   // The storage error text is often empty, so ask the bucket whether the file exists at all.
   const i=v.storage_path.lastIndexOf("/"),{data:ls,error:le}=await db.storage.from("bot-code").list(v.storage_path.slice(0,i),{search:v.storage_path.slice(i+1),limit:5});
   if(!le&&!(ls??[]).some(o=>o.name===v.storage_path.slice(i+1)))
    return{findings:[{id:"missing-file",level:"block",source:"static",msg:"The code file for this version is missing from storage. Upload the bot again."}],metrics};
   throw new Error("code download failed: "+(error.message||error.name||"unknown"))}
  writeFileSync(join(dir,"bot.py"),Buffer.from(await blob.arrayBuffer()),{mode:0o644});chmodSync(dir,0o755);
  const mk=(v.bots.markets??[]).filter(m=>SYM[m]).slice(0,5);
  // 1. static scan: never executes the code
  await stage("static");
  let s;try{s=await runIn(sandbox,dir,{},20000,"analyze.py")}catch(e){s={findings:[{id:"analyser",level:"block",msg:"Static scan failed: "+String(e.message).slice(0,120)}],metrics:{}}}
  findings.push(...tag(s.findings,"static"));metrics.static=s.metrics;
  if(findings.some(f=>f.level==="block"))return{findings,metrics};
  if(!mk.length){findings.push({id:"markets",level:"block",source:"markets",msg:"None of the bot's markets are tradable on Tick right now."});return{findings,metrics}}
  // 2. behaviour probes on synthetic data, inside the sandbox
  await stage("probe");
  let p;try{p=await runIn(sandbox,dir,{markets:mk},90000,"probe.py")}catch(e){p={findings:[{id:"probe",level:"block",msg:/timeout/.test(e.message)?"Did not finish the behaviour tests in time":"Behaviour tests crashed: "+String(e.message).slice(0,160)}],metrics:{}}}
  findings.push(...tag(p.findings,"probe"));metrics.probe=p.metrics;
  if(findings.some(f=>f.level==="block"))return{findings,metrics};
  // 3. real-data backtest: the same fees, slippage and rules as live verification
  await stage("backtest");
  try{
   const N=30*24,raw={};for(const m of mk)raw[m]=await history(SYM[m],N+500);
   const n=Math.min(...mk.map(m=>raw[m].length));
   if(n<524){findings.push({id:"history",level:"warn",source:"backtest",msg:"Not enough market history to backtest these markets."});return{findings,metrics}}
   const cs={};for(const m of mk)cs[m]=raw[m].slice(-n);
   const start=Math.max(499,n-N),series=(await sandbox(dir,{markets:mk,candles:cs,start},120000)).series;
   const closes={};for(const m of mk)closes[m]=cs[m].slice(start).map(c=>c.c);
   const r=simulate(series,closes,mk,VOL);
   metrics.backtest={days:30,trades:r.trades,ret:+r.ret.toFixed(2),dd:+r.dd.toFixed(2),sharpe:+r.sharpe.toFixed(2)};
   findings.push(...tag(judgeBacktest(r,rules),"backtest"))
  }catch(e){findings.push({id:"backtest",level:"block",source:"backtest",msg:/timeout/.test(e.message)?"Backtest on real data timed out (limit 2 minutes)":"Backtest on real data failed: "+String(e.message).slice(0,160)})}
  return{findings,metrics}
 }finally{rmSync(dir,{recursive:true,force:true})}}

export async function processChecks(db,ctx){
 const{data:jobs}=await db.from("bot_versions").select("id,bot_id,storage_path,bots!bot_versions_bot_id_fkey(markets,current_version_id,pending_listing,verification,verification_paid)").eq("check_state","pending").order("created_at").limit(2);
 if(!jobs?.length)return;
 const{data:cfg}=await db.from("app_config").select("value").eq("key","verification_rules").single(),rules=JSON.parse(cfg.value);
 for(const j of jobs){
  const{error:le}=await db.from("bot_versions").update({check_state:"running"}).eq("id",j.id).eq("check_state","pending");if(le)continue;
  let res;try{res=await checkVersion(db,{...j,bots:j.bots},ctx,rules)}catch(e){res={findings:[{id:"checker",level:"warn",msg:"Checks could not run: "+String(e.message).slice(0,160)}],metrics:{}};
   await db.from("bot_versions").update({check_state:"pending"}).eq("id",j.id);ctx.logErr?.("code check",e.message);continue}
  const{state,notes}=summarise(res.findings);
  await db.from("bot_versions").update({check_state:state,check_stage:"done",check_report:{findings:res.findings,metrics:res.metrics,rules_version:1},checked_at:new Date()}).eq("id",j.id);
  if(j.bots?.current_version_id===j.id){await db.from("bots").update({code_check:state,code_check_notes:notes}).eq("id",j.bot_id);
   // A listing created through the upload form goes live only after its code passes.
   if(j.bots.pending_listing)await db.from("bots").update(state==="failed"?{pending_listing:false}:{listed:true,pending_listing:false}).eq("id",j.bot_id);
   // Verification is paid once per bot: a new version that passes the checks is re-verified at no cost.
   if(state!=="failed"&&j.bots.verification_paid&&j.bots.verification==="none")await db.rpc("start_verification_run",{p_bot:j.bot_id,p_version:j.id,p_fee:0,p_payment:null})}}}