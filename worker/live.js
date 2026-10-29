import crypto from "node:crypto";
import {mkdtempSync,writeFileSync,rmSync,chmodSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {BINANCE as BASE} from "./config.js";
const HOUR=3600e3,sleep=ms=>new Promise(r=>setTimeout(r,ms));
const MASTER=Buffer.from(process.env.KEY_ENCRYPTION_SECRET||"","base64");
const filters=new Map();let bnbCache=0;

function dec(b64){
 if(MASTER.length!==32)throw new Error("KEY_ENCRYPTION_SECRET must be 32 bytes, base64");
 const raw=Buffer.from(b64,"base64"),d=crypto.createDecipheriv("aes-256-gcm",MASTER,raw.subarray(0,12));
 d.setAuthTag(raw.subarray(raw.length-16));
 return Buffer.concat([d.update(raw.subarray(12,raw.length-16)),d.final()]).toString()}
async function bn(method,path,params,key,secret){
 const qs=new URLSearchParams({...params,timestamp:String(Date.now()),recvWindow:"10000"}).toString();
 const sig=crypto.createHmac("sha256",secret).update(qs).digest("hex");
 const r=await fetch(`${BASE}${path}?${qs}&signature=${sig}`,{method,headers:{"X-MBX-APIKEY":key}}),j=await r.json();
 if(!r.ok)throw new Error(`binance ${j.code}: ${j.msg}`);return j}
const retryable=e=>!/^binance -?\d+/.test(e.message)||/^binance -(1003|1006|1007|1015|1016):/.test(e.message);
async function rules(sym){
 if(filters.has(sym))return filters.get(sym);
 const f=(await(await fetch(`${BASE}/api/v3/exchangeInfo?symbol=${sym}`)).json()).symbols[0].filters,find=t=>f.find(x=>x.filterType===t)||{};
 const dp=s=>(s.toFixed(10).replace(/0+$/,"").split(".")[1]||"").length,step=+find("LOT_SIZE").stepSize,tick=+find("PRICE_FILTER").tickSize||0.01;
 const r={step,dp:dp(step),tick,pdp:dp(tick),mn:+(find("NOTIONAL").minNotional||find("MIN_NOTIONAL").minNotional)||10};filters.set(sym,r);return r}
const flr=(q,r)=>(Math.floor(q/r.step+1e-9)*r.step).toFixed(r.dp);
const fpx=(p,r)=>(Math.floor(p/r.tick+1e-9)*r.tick).toFixed(r.pdp);
async function bnbPrice(){return bnbCache||(bnbCache=+(await(await fetch(`${BASE}/api/v3/ticker/price?symbol=BNBUSDT`)).json()).price||0)}
const cid=(...p)=>"r"+crypto.createHash("sha1").update(p.join("|")).digest("hex").slice(0,30);

async function order(sym,side,amt,id,key,secret){
 const p={symbol:sym,side,type:"MARKET",newClientOrderId:id};if(amt.quote)p.quoteOrderQty=amt.quote;else p.quantity=amt.qty;
 let o,last,est=false;
 for(let i=0;i<3&&!o;i++){
  try{o=await bn("POST","/api/v3/order",p,key,secret)}
  catch(e){last=e;const dup=/-2010/.test(e.message)&&/uplicate/i.test(e.message);if(!dup&&!retryable(e))throw e;
   try{o=await bn("GET","/api/v3/order",{symbol:sym,origClientOrderId:id},key,secret);est=true}catch{}  // did the first try go through?
   if(!o)await sleep(1500*(i+1))}}
 if(!o)throw last;
 const base=sym.replace("USDT",""),exec=+o.executedQty,quote=+o.cummulativeQuoteQty,price=exec?quote/exec:0;
 let usdt=0,baseFee=0,bnb=0;
 for(const f of o.fills||[]){const c=+f.commission;if(f.commissionAsset==="USDT")usdt+=c;else if(f.commissionAsset===base)baseFee+=c;else if(f.commissionAsset==="BNB")bnb+=c}
 const fee=est?quote*0.001:usdt+baseFee*price+(bnb?bnb*await bnbPrice():0);
 return{id:String(o.orderId),exec,net:exec-(est?0:baseFee),quote,price,fee}}

const equityOf=(s,prices)=>s.cash+Object.entries(s.pos).reduce((a,[m,p])=>a+p.qty*(prices[m]??p.avg),0);
const save=(db,r,s)=>db.from("rentals").update({live_state:s}).eq("id",r.id);
const rec=(db,r,m,side,o,realized)=>db.from("fills").insert({bot_id:r.bot_id,rental_id:r.id,market:m,side,qty:o.exec,price:o.price,fee:o.fee,realized_pnl:realized,exchange_order_id:o.id});
const stop=(db,r,reason)=>db.from("rentals").update({live:false,paused_reason:reason}).eq("id",r.id);
const symOf=(SYM,m)=>SYM[m]||m.replace("/","");

async function cancelStop(sym,p,key,secret){if(!p.stopId)return;try{await bn("DELETE","/api/v3/order",{symbol:sym,orderId:p.stopId},key,secret)}catch{}p.stopId=null}
async function placeStop(sym,p,pct,px,ru,key,secret,log){
 if(!pct||!(p.qty>0)||p.stopId)return;const q=+flr(p.qty,ru);if(!(q>0)||q*px<ru.mn*1.1)return;
 const sp=px*(1-pct/100);
 try{p.stopId=(await bn("POST","/api/v3/order",{symbol:sym,side:"SELL",type:"STOP_LOSS_LIMIT",timeInForce:"GTC",quantity:q,price:fpx(sp*0.995,ru),stopPrice:fpx(sp,ru)},key,secret)).orderId}
 catch(e){log("stop-loss not placed",e.message)}}
async function syncStops(db,r,s,SYM,key,secret){
 for(const[m,p]of Object.entries(s.pos)){
  if(!p.stopId)continue;let x;
  try{x=await bn("GET","/api/v3/order",{symbol:symOf(SYM,m),orderId:p.stopId},key,secret)}catch{continue}
  if(x.status==="FILLED"){const exec=+x.executedQty,quote=+x.cummulativeQuoteQty,price=exec?quote/exec:0,fee=quote*0.001;
   s.cash+=quote-fee;p.qty=Math.max(0,p.qty-exec);p.stopId=null;await rec(db,r,m,"sell",{exec,price,fee,id:String(x.orderId)},(price-p.avg)*exec-fee);await save(db,r,s)}
  else if(["CANCELED","EXPIRED","REJECTED"].includes(x.status))p.stopId=null}}

async function flatten(db,r,s,SYM,key,secret,reason,log){
 await syncStops(db,r,s,SYM,key,secret);
 for(const[m,p]of Object.entries(s.pos)){
  const sym=symOf(SYM,m),ru=await rules(sym);await cancelStop(sym,p,key,secret);
  if(!(p.qty>0))continue;const q=+flr(p.qty,ru);if(!(q>0))continue;
  try{const o=await order(sym,"SELL",{qty:q},cid(r.id,"flat",q,Math.floor(Date.now()/HOUR),m),key,secret);
   s.cash+=o.quote-o.fee;p.qty-=o.exec;await rec(db,r,m,"sell",o,(o.price-p.avg)*o.exec-o.fee);await save(db,r,s)}
  catch(e){log("flatten "+r.id+" "+m,e.message)}}
 if(reason)await stop(db,r,reason);await save(db,r,s)}

async function decide(db,r,mk,cs,sandbox,s){
 const{data:vr}=await db.from("verification_runs").select("bot_versions(storage_path)").eq("bot_id",r.bot_id).eq("state","verified").order("created_at",{ascending:false}).limit(1);
 const path=vr?.[0]?.bot_versions?.storage_path;if(!path)throw new Error("No verified code version");
 const dir=mkdtempSync(join(tmpdir(),"relay-live-"));
 try{const{data:blob,error}=await db.storage.from("bot-code").download(path);if(error)throw new Error("code download failed");
  writeFileSync(join(dir,"bot.py"),Buffer.from(await blob.arrayBuffer()),{mode:0o644});chmodSync(dir,0o755);
  return await sandbox(dir,{markets:mk,candles:cs,state:s.bot_state||{}})}
 finally{rmSync(dir,{recursive:true,force:true})}}

async function one(db,r,ctx){
 const{SYM,halt,candles,sandbox}=ctx,log=ctx.log||console.error,c=r.exchange_connections;if(!c)return;
 let s=r.live_state&&r.live_state.cash!=null?r.live_state:null;
 const hasPos=s&&Object.values(s.pos||{}).some(p=>p.qty>0);
 const active=r.live&&r.status==="active"&&!halt&&r.bots.verification==="verified";
 if(!active){
  if(hasPos){const why=r.status!=="active"?"Rental ended":halt?"Live trading halted by Relay":!r.live?null:"Bot is no longer verified";
   await flatten(db,r,s,SYM,dec(c.api_key_enc),dec(c.api_secret_enc),r.live?why:null,log)}
  else if(r.live)await stop(db,r,halt?"Live trading halted by Relay":r.status!=="active"?"Rental ended":"Bot is no longer verified");
  return}
 const key=dec(c.api_key_enc),secret=dec(c.api_secret_enc),alloc=+r.allocation_usd;
 const mk=r.bots.markets.filter(m=>SYM[m]).slice(0,10);if(!mk.length)return stop(db,r,"No supported markets");
 if(!s){
  const acct=await bn("GET","/api/v3/account",{},key,secret);
  if(+(acct.balances.find(b=>b.asset==="USDT")?.free||0)<alloc)return stop(db,r,"Not enough free USDT for the allocation");
  s={cash:alloc,pos:{},day:"",dayStart:alloc,peak:alloc,slot:0,errors:0}}
 const slot=Math.floor(Date.now()/HOUR);if(s.slot===slot)return;
 await syncStops(db,r,s,SYM,key,secret);
 const acct2=await bn("GET","/api/v3/account",{},key,secret);
 for(const[m,p]of Object.entries(s.pos)){if(!(p.qty>0))continue;const a=acct2.balances.find(b=>b.asset===m.split("/")[0]),have=a?+a.free+ +a.locked:0;
  if(have<p.qty*0.98){await db.from("rentals").update({live:false,paused_reason:`Position mismatch on ${m}: the account holds less than Relay expected. Check for manual trades.`,live_state:{...s,pos:{}}}).eq("id",r.id);return}}
 const cs={},prices={};for(const m of mk){cs[m]=await candles(m);prices[m]=cs[m].at(-1).c}
 const eq=equityOf(s,prices),today=new Date().toISOString().slice(0,10);
 if(s.day!==today){s.day=today;s.dayStart=eq}
 s.peak=Math.max(s.peak??alloc,eq);
 if(eq<=s.dayStart*(1-r.max_daily_loss_pct/100))return flatten(db,r,s,SYM,key,secret,`Daily loss limit of ${r.max_daily_loss_pct}% reached`,log);
 if(eq<=s.peak*(1-r.max_drawdown_pct/100))return flatten(db,r,s,SYM,key,secret,`Max drawdown of ${r.max_drawdown_pct}% reached`,log);
 const out=await decide(db,r,mk,cs,sandbox,s),t=out.targets||{};
 if(JSON.stringify(out.state||{}).length<16000)s.bot_state=out.state||{};
 for(const m of mk){
  const sym=SYM[m],ru=await rules(sym),p=(s.pos[m]??={qty:0,avg:0}),px=prices[m];
  const e=Math.max(0,Math.min(1,+t[m]||0)),d=e*eq/mk.length/px-p.qty;
  if(d>0){const spend=Math.min(d*px,s.cash*0.995),q=Math.floor(spend*100)/100;
   if(q<ru.mn*1.1||q<eq*0.01)continue;
   const o=await order(sym,"BUY",{quote:q},cid(r.id,slot,m,"buy"),key,secret);
   p.avg=(p.qty*p.avg+o.net*o.price)/(p.qty+o.net);p.qty+=o.net;s.cash-=o.quote+o.fee;await cancelStop(sym,p,key,secret);await rec(db,r,m,"buy",o,null);await save(db,r,s)}
  else if(d<0){const q=+flr(Math.min(-d,p.qty),ru);
   if(!(q>0)||q*px<ru.mn*1.1)continue;
   await cancelStop(sym,p,key,secret);
   const o=await order(sym,"SELL",{qty:q},cid(r.id,slot,m,"sell"),key,secret);
   s.cash+=o.quote-o.fee;p.qty-=o.exec;await rec(db,r,m,"sell",o,(o.price-p.avg)*o.exec-o.fee);await save(db,r,s)}}
 for(const m of mk){const p=s.pos[m];if(p?.qty>0&&r.stop_loss_pct&&!p.stopId)await placeStop(SYM[m],p,r.stop_loss_pct,prices[m],await rules(SYM[m]),key,secret,log)}
 s.slot=slot;s.errors=0;await save(db,r,s)}

export async function liveTick(db,ctx){
 const log=ctx.log||console.error;
 const{data:rs}=await db.from("rentals").select("*,bots(id,name,markets,verification),exchange_connections(api_key_enc,api_secret_enc)").not("connection_id","is",null);
 bnbCache=0;
 for(const r of rs??[]){
  try{await one(db,r,ctx)}
  catch(e){await log("live "+r.id,e.message);
   const s=r.live_state?.cash!=null?r.live_state:null,n=(s?.errors??0)+1;
   if(!s||n>=3)await stop(db,r,"Stopped after repeated errors: "+e.message.slice(0,120));
   else await db.from("rentals").update({live_state:{...s,errors:n}}).eq("id",r.id)}}}
