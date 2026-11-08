import crypto from "node:crypto";
// Kraken spot adapter for the live worker. Same safety rules as the other brokers:
// long-only, only the allocated cash, daily-loss and drawdown stops, exchange-side stop-loss, position reconciliation.
// The user's API key must not be able to withdraw. That is checked when the key is saved and again before trading starts.
const API="https://api.kraken.com",HOUR=3600e3,sleep=ms=>new Promise(r=>setTimeout(r,ms));
let lastNonce=0;const nonce=()=>(lastNonce=Math.max(lastNonce+1,Date.now()));
export const sign=(path,n,body,secret)=>{
 const h=crypto.createHash("sha256").update(String(n)+body).digest();
 return crypto.createHmac("sha512",Buffer.from(secret,"base64")).update(Buffer.concat([Buffer.from(path),h])).digest("base64")};
const cid=(...p)=>"t"+crypto.createHash("sha1").update(p.join("|")).digest("hex").slice(0,16);   // 17 characters, Kraken allows up to 18

async function priv(name,params,k){
 const n=nonce(),body=new URLSearchParams({nonce:String(n),...params}).toString(),path="/0/private/"+name;
 let r;
 try{r=await fetch(API+path,{method:"POST",headers:{"API-Key":k.key,"API-Sign":sign(path,n,body,k.secret),"Content-Type":"application/x-www-form-urlencoded"},body,signal:AbortSignal.timeout(20000)})}
 catch(e){const x=new Error("kraken network: "+e.message);x.ambiguous=true;throw x}
 const t=await r.text();let j;
 try{j=JSON.parse(t)}catch{const x=new Error("kraken "+r.status+" bad response");x.ambiguous=r.status>=500;throw x}
 if(j.error?.length){const e=new Error("kraken: "+j.error.join(", "));e.ambiguous=/EService:(Busy|Unavailable|Timeout)|EGeneral:Internal/.test(j.error.join());e.auth=/EAPI:Invalid (key|signature)|EGeneral:Permission denied|EAPI:Invalid key/.test(j.error.join());throw e}
 return j.result}

let pairMap=null,pairsAt=0;
async function pairsFor(){
 if(!pairMap||Date.now()-pairsAt>HOUR){
  const r=await fetch(API+"/0/public/AssetPairs"),j=await r.json();if(!r.ok||j.error?.length)throw new Error("kraken: could not load markets");
  pairMap=new Map(Object.values(j.result).filter(v=>v.quote==="ZUSD"&&v.status==="online"&&v.wsname).map(v=>[v.wsname,v]));pairsAt=Date.now()}
 return pairMap}
export const kSym=m=>{const b=m.split("/")[0];return(b==="BTC"?"XBT":b==="DOGE"?"XDG":b)+"/USD"};
const flr=(x,d)=>(Math.floor(x*10**d+1e-9)/10**d).toFixed(d);
const usd=bal=>+(bal.ZUSD??bal.USD??0);

async function findRecent(info,side,since,k){   // after an unclear failure: did the order actually go through?
 try{const c=(await priv("ClosedOrders",{start:String(Math.floor(since/1000)-5)},k)).closed||{};
  const o=Object.entries(c).find(([,v])=>v.descr?.pair===info.altname&&v.descr?.type===side&&v.opentm>=since/1000-5);if(o)return o[0]}catch{}
 try{const c=(await priv("OpenOrders",{},k)).open||{};
  const o=Object.entries(c).find(([,v])=>v.descr?.pair===info.altname&&v.descr?.type===side&&v.opentm>=since/1000-5);if(o)return o[0]}catch{}
 return null}
async function wait(txid,k){
 let o;for(let i=0;i<12;i++){o=(await priv("QueryOrders",{txid},k))[txid];if(o&&["closed","canceled","expired"].includes(o.status))break;await sleep(1500)}
 return o}
async function order(info,side,amt,id,k){
 const p={pair:info.altname,type:side,ordertype:"market",oflags:"fciq"+(amt.quote?",viqc":""),volume:String(amt.quote??amt.qty),cl_ord_id:id},since=Date.now();
 let txid;
 try{txid=(await priv("AddOrder",p,k)).txid?.[0]}
 catch(e){if(!e.ambiguous)throw e;await sleep(2000);txid=await findRecent(info,side,since,k);if(!txid)throw e}
 if(!txid)throw new Error("kraken: order was not accepted");
 let o=await wait(txid,k);
 if(!o||!["closed","canceled","expired"].includes(o.status)){try{await priv("CancelOrder",{txid},k)}catch{}await sleep(800);o=(await priv("QueryOrders",{txid},k))[txid]}
 const exec=+o?.vol_exec||0,quote=+o?.cost||0,fee=+o?.fee||0;
 if(!(exec>0))throw new Error("kraken: order not filled ("+(o?.status||"unknown")+")");
 return{id:txid,exec,net:exec,quote,price:quote/exec,fee}}   // fee is in dollars (fciq)

async function cancelStop(p,k){if(!p.stopId)return;try{await priv("CancelOrder",{txid:p.stopId},k);await sleep(600)}catch{}p.stopId=null}
async function placeStop(info,p,pct,px,k,log){
 if(!pct||!(p.qty>0)||p.stopId)return;const d=info.lot_decimals,q=flr(p.qty,d);if(!(+q>=+info.ordermin)||+q*px<2)return;
 const sp=px*(1-pct/100),pd=info.pair_decimals;
 try{p.stopId=(await priv("AddOrder",{pair:info.altname,type:"sell",ordertype:"stop-loss-limit",price:flr(sp,pd),price2:flr(sp*0.995,pd),volume:q},k)).txid?.[0]||null}
 catch(e){log("stop-loss not placed",e.message)}}
async function syncStops(h,db,r,s,k,PM){
 for(const[m,p]of Object.entries(s.pos)){
  if(!p.stopId)continue;let x;
  try{x=(await priv("QueryOrders",{txid:p.stopId},k))[p.stopId]}catch{continue}
  if(!x)continue;
  if(x.status==="closed"&&+x.vol_exec>0){const exec=+x.vol_exec,quote=+x.cost,fee=+x.fee,price=quote/exec;
   const sid=p.stopId;s.cash+=quote-fee;p.qty=Math.max(0,p.qty-exec);p.stopId=null;await h.rec(db,r,m,"sell",{exec,price,fee,id:String(sid)},(price-p.avg)*exec-fee);await h.save(db,r,s)}
  else if(["canceled","expired"].includes(x.status))p.stopId=null}}

async function flatten(h,db,r,s,k,reason,log,PM){
 await syncStops(h,db,r,s,k,PM);
 for(const[m,p]of Object.entries(s.pos)){
  const info=PM.get(kSym(m));await cancelStop(p,k);
  if(!(p.qty>0)||!info)continue;const q=flr(p.qty,info.lot_decimals);if(!(+q>0))continue;
  try{const o=await order(info,"sell",{qty:q},cid(r.id,"flat",q,Math.floor(Date.now()/HOUR),m),k);
   s.cash+=o.quote-o.fee;p.qty-=o.exec;await h.rec(db,r,m,"sell",o,(o.price-p.avg)*o.exec-o.fee);await h.save(db,r,s)}
  catch(e){log("flatten "+r.id+" "+m,e.message)}}
 if(reason)await h.stop(db,r,reason);await h.save(db,r,s)}

export async function oneKraken(h,db,r,ctx){
 const{halt,candles,sandbox}=ctx,log=ctx.log||console.error,c=r.exchange_connections,k={key:h.dec(c.api_key_enc),secret:h.dec(c.api_secret_enc)};
 let s=r.live_state&&r.live_state.cash!=null?r.live_state:null;
 const hasPos=s&&Object.values(s.pos||{}).some(p=>p.qty>0);
 const active=r.live&&r.status==="active"&&!halt&&r.bots.verification==="verified";
 const PM=await pairsFor();
 if(!active){
  if(hasPos){const why=r.status!=="active"?"Rental ended":halt?"Live trading halted by Tick":!r.live?null:"Bot is no longer verified";
   await flatten(h,db,r,s,k,r.live?why:null,log,PM)}
  else if(r.live)await h.stop(db,r,halt?"Live trading halted by Tick":r.status!=="active"?"Rental ended":"Bot is no longer verified");
  return}
 const alloc=+r.allocation_usd;
 const mk=r.bots.markets.filter(m=>PM.has(kSym(m))).slice(0,10);if(!mk.length)return h.stop(db,r,"This bot's markets are not tradable on Kraken");
 if(!s){
  const perms=(await priv("GetApiKeyInfo",{},k)).permissions||[];
  if(perms.includes("withdraw-funds"))return h.stop(db,r,"Your Kraken key can withdraw funds. Create a new key without withdrawal permission and reconnect");
  if(!perms.includes("modify-trades")||!perms.includes("query-funds"))return h.stop(db,r,"Your Kraken key is missing a permission Tick needs to trade. Reconnect with a new key");
  if(usd(await priv("Balance",{},k))<alloc)return h.stop(db,r,"Not enough free USD on Kraken for the allocation");
  s={cash:alloc,pos:{},day:"",dayStart:alloc,peak:alloc,slot:0,errors:0}}
 const slot=Math.floor(Date.now()/HOUR);if(s.slot===slot)return;
 await syncStops(h,db,r,s,k,PM);
 const bal=await priv("Balance",{},k);
 for(const[m,p]of Object.entries(s.pos)){if(!(p.qty>0))continue;const have=+(bal[PM.get(kSym(m)).base]||0);
  if(have<p.qty*0.98){await db.from("rentals").update({live:false,paused_reason:`Position mismatch on ${m}: the account holds less than Tick expected. Check for manual trades.`,live_state:{...s,pos:{}}}).eq("id",r.id);return}
  p.qty=Math.min(p.qty,have)}   // only ever trim to reality, never claim your other holdings
 const cs={},prices={};for(const m of mk){cs[m]=await candles(m);prices[m]=cs[m].at(-1).c}
 const eq=h.equityOf(s,prices),today=new Date().toISOString().slice(0,10);
 if(s.day!==today){s.day=today;s.dayStart=eq}
 s.peak=Math.max(s.peak??alloc,eq);
 if(eq<=s.dayStart*(1-r.max_daily_loss_pct/100))return flatten(h,db,r,s,k,`Daily loss limit of ${r.max_daily_loss_pct}% reached`,log,PM);
 if(eq<=s.peak*(1-r.max_drawdown_pct/100))return flatten(h,db,r,s,k,`Max drawdown of ${r.max_drawdown_pct}% reached`,log,PM);
 const out=await h.decide(db,r,mk,cs,sandbox,s),t=out.targets||{};
 if(JSON.stringify(out.state||{}).length<16000)s.bot_state=out.state||{};
 for(const m of mk){
  const info=PM.get(kSym(m)),p=(s.pos[m]??={qty:0,avg:0}),px=prices[m];
  const e=Math.max(0,Math.min(1,+t[m]||0)),d=e*eq/mk.length/px-p.qty;
  if(d>0){const spend=Math.min(d*px,s.cash*0.99),q=Math.floor(spend*100)/100;   // headroom for the fee
   if(q<Math.max(2,+info.costmin||0)||q<eq*0.01||q/px<+info.ordermin)continue;
   const o=await order(info,"buy",{quote:q},cid(r.id,slot,m,"buy"),k);
   p.avg=(p.qty*p.avg+o.quote+o.fee)/(p.qty+o.exec);p.qty+=o.exec;s.cash-=o.quote+o.fee;await cancelStop(p,k);await h.rec(db,r,m,"buy",o,null);await h.save(db,r,s)}
  else if(d<0){const q=flr(Math.min(-d,p.qty),info.lot_decimals);
   if(!(+q>=+info.ordermin)||+q*px<2)continue;
   await cancelStop(p,k);
   const o=await order(info,"sell",{qty:q},cid(r.id,slot,m,"sell"),k);
   s.cash+=o.quote-o.fee;p.qty-=o.exec;await h.rec(db,r,m,"sell",o,(o.price-p.avg)*o.exec-o.fee);await h.save(db,r,s)}}
 for(const m of mk){const p=s.pos[m];if(p?.qty>0&&r.stop_loss_pct&&!p.stopId)await placeStop(PM.get(kSym(m)),p,r.stop_loss_pct,prices[m],k,log)}
 s.slot=slot;s.errors=0;await h.save(db,r,s)}