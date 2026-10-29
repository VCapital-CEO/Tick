import {mkdtempSync,writeFileSync,rmSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {BINANCE} from "./config.js";
import {step,metrics,CAPITAL} from "./engine.js";

function cl_(fills){const c=fills.filter(f=>f.realized_pnl!=null),w=c.filter(f=>f.realized_pnl>0),l=c.filter(f=>f.realized_pnl<0);
 const aw=w.length?w.reduce((a,f)=>a+f.realized_pnl,0)/w.length:0,al=l.length?-l.reduce((a,f)=>a+f.realized_pnl,0)/l.length:0;
 return{payoff:al>0?aw/al:null}}
// series: one {market:target} per step. closes: {market:[close per step]}.
export function simulate(series,closes,markets,VOL={}){
 const st={cash:CAPITAL,pos:{}},eq=[],fills=[];
 series.forEach((t,i)=>{
  const prices=Object.fromEntries(markets.map(m=>[m,closes[m][i]])),r=step(st,prices,t,VOL);
  fills.push(...r.fills);eq.push({equity:r.equity})});
 const m=metrics(eq,fills),k=Math.ceil(eq.length/200),pts=eq.filter((_,i)=>i%k===0);
 const h=Math.floor(eq.length/2),a=eq.length>=20?metrics(eq.slice(0,h),[]):null,b=eq.length>=20?metrics(eq.slice(h),[]):null;
 const halves=a&&{first:{ret:a.ret,sharpe:a.sharpe},second:{ret:b.ret,sharpe:b.sharpe}};
 // Overfitting hint: a strategy that only worked in the first half, or whose risk-adjusted return collapsed in the second.
 const w=cl_(fills);
 const consistent=!halves||!((a.ret>0&&b.ret<=0)||(a.sharpe>0.5&&b.sharpe<a.sharpe*0.3));
 return{...m,payoff:w.payoff,halves,consistent,equity:pts.map(x=>+(x.equity/CAPITAL*100).toFixed(2))}}

export async function history(sym,n){
 let out=[],end=Date.now();
 while(out.length<n){
  const r=await fetch(`${BINANCE}/api/v3/klines?symbol=${sym}&interval=1h&limit=1000&endTime=${end}`);
  if(!r.ok)throw new Error("klines "+r.status);
  const k=await r.json();if(!k.length)break;out=k.concat(out);end=k[0][0]-1;await new Promise(r=>setTimeout(r,80))}
 return out.map(c=>({t:c[0],o:+c[1],h:+c[2],l:+c[3],c:+c[4],v:+c[5]})).filter(c=>c.t+3600e3<=Date.now()).slice(-n)}

export async function processBacktests(db,{sandbox,SYM,VOL}){
 const{data:jobs}=await db.from("backtests").select("*,bots(markets,current_version_id)").eq("state","pending").order("created_at").limit(2);
 for(const j of jobs??[]){
  await db.from("backtests").update({state:"running"}).eq("id",j.id);
  const dir=mkdtempSync(join(tmpdir(),"relay-bt-"));
  try{
   const mk=j.bots.markets.filter(m=>SYM[m]).slice(0,5);if(!mk.length)throw new Error("No supported markets");
   const{data:v}=await db.from("bot_versions").select("storage_path").eq("id",j.bots.current_version_id).single();
   const{data:blob,error}=await db.storage.from("bot-code").download(v.storage_path);if(error)throw new Error("code download failed");
   writeFileSync(join(dir,"bot.py"),Buffer.from(await blob.arrayBuffer()),{mode:0o644});chmodSync(dir,0o755);
   const N=j.days*24,raw={};for(const m of mk)raw[m]=await history(SYM[m],N+500);
   const n=Math.min(...mk.map(m=>raw[m].length));if(n<524)throw new Error("Not enough history for these markets");
   const cs={};for(const m of mk)cs[m]=raw[m].slice(-n);
   const start=Math.max(499,n-N),series=(await sandbox(dir,{markets:mk,candles:cs,start},120000)).series;
   const closes={};for(const m of mk)closes[m]=cs[m].slice(start).map(c=>c.c);
   await db.from("backtests").update({state:"done",result:{...simulate(series,closes,mk,VOL),days:j.days}}).eq("id",j.id)
  }catch(e){await db.from("backtests").update({state:"failed",error:String(e.message).slice(0,300)}).eq("id",j.id)}
  finally{rmSync(dir,{recursive:true,force:true})}}}