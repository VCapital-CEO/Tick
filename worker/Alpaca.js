import crypto from "node:crypto";
// Alpaca broker adapter for the live worker. Same safety rules as the Binance path in live.js:
// long-only, only the allocated cash, daily-loss and drawdown stops, exchange-side stop-loss, position reconciliation.
const API="https://api.alpaca.markets/v2",HOUR=3600e3,FEE=0.0025,sleep=ms=>new Promise(r=>setTimeout(r,ms));
const DONE=["filled","canceled","expired","rejected","done_for_day"];
let assets=null,assetsAt=0;

async function al(method,path,body,tok){
 const r=await fetch(API+path,{method,headers:{Authorization:"Bearer "+tok,Accept:"application/json","Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
 const t=await r.text();let j;try{j=t?JSON.parse(t):{}}catch{j={message:t.slice(0,120)}}
 if(!r.ok){const e=new Error(`alpaca ${r.status}: ${j.message||t.slice(0,120)}`);e.status=r.status;throw e}
 return j}
const retryable=e=>e.status==null||e.status>=500||e.status===429;
const cid=(...p)=>"r"+crypto.createHash("sha1").update(p.join("|")).digest("hex").slice(0,30);
const dpOf=s=>(String(s).includes(".")?String(s).replace(/0+$/,"").split(".")[1]||"":"").length;
export const alpSym=m=>m.split("/")[0]+"/USD";
const norm=s=>String(s).replace("/","");

async function rulesFor(tok){
 if(!assets||Date.now()-assetsAt>HOUR){
  const list=await al("GET","/assets?asset_class=crypto&status=active",null,tok);
  assets=new Map(list.filter(a=>a.tradable).map(a=>[a.symbol,a]));assetsAt=Date.now()}
 return assets}
const stepOf=a=>+a.min_trade_increment||1e-9;
const flr=(q,a)=>{const st=stepOf(a),dp=dpOf(a.min_trade_increment||"0.000000001");return(Math.floor(q/st+1e-9)*st).toFixed(dp)};
const fpx=(p,a)=>{const t=+a.price_increment||0.01;return(Math.floor(p/t+1e-9)*t).toFixed(dpOf(a.price_increment||"0.01"))};

async function order(sym,side,amt,id,tok){
 const body={symbol:sym,side,type:"market",time_in_force:"gtc",client_order_id:id};
 if(amt.quote)body.notional=String(amt.quote);else body.qty=String(amt.qty);
 let o,last;
 for(let i=0;i<3&&!o;i++){
  try{o=await al("POST","/orders",body,tok)}
  catch(e){last=e;
   try{o=await al("GET","/orders:by_client_order_id?client_order_id="+id,null,tok)}catch{}  // did the first try go through?
   if(!o){if(!retryable(e))throw e;await sleep(1500*(i+1))}}}
 if(!o)throw last;
 for(let i=0;i<12&&!DONE.includes(o.status);i++){await sleep(1500);o=await al("GET","/orders/"+o.id,null,tok)}
 if(!DONE.includes(o.status)){try{await al("DELETE","/orders/"+o.id,null,tok)}catch{}await sleep(800);o=await al("GET","/orders/"+o.id,null,tok)}
 const exec=+o.filled_qty||0,price=+o.filled_avg_price||0,quote=exec*price;
 if(!(exec>0))throw new Error("alpaca order not filled ("+o.status+")");
 // Alpaca takes the crypto fee in the asset on buys and in dollars on sells.
 return{id:String(o.id),exec,net:side==="buy"?exec*(1-FEE):exec,quote,price,fee:quote*FEE}}

async function cancelStop(p,tok){if(!p.stopId)return;try{await al("DELETE","/orders/"+p.stopId,null,tok);await sleep(600)}catch{}p.stopId=null}
async function placeStop(sym,p,pct,px,a,tok,log){
 if(!pct||!(p.qty>0)||p.stopId)return;const q=+flr(p.qty,a);if(!(q>0)||q*px<2)return;
 const sp=px*(1-pct/100);
 try{p.stopId=(await al("POST","/orders",{symbol:sym,side:"sell",type:"stop_limit",time_in_force:"gtc",qty:String(q),stop_price:fpx(sp,a),limit_price:fpx(sp*0.995,a)},tok)).id}
 catch(e){log("stop-loss not placed",e.message)}}
async function syncStops(h,db,r,s,tok){
 for(const[m,p]of Object.entries(s.pos)){
  if(!p.stopId)continue;let x;
  try{x=await al("GET","/orders/"+p.stopId,null,tok)}catch{continue}
  if(x.status==="filled"){const exec=+x.filled_qty,price=+x.filled_avg_price||0,quote=exec*price,fee=quote*FEE;
   s.cash+=quote-fee;p.qty=Math.max(0,p.qty-exec);p.stopId=null;await h.rec(db,r,m,"sell",{exec,price,fee,id:String(x.id)},(price-p.avg)*exec-fee);await h.save(db,r,s)}
  else if(["canceled","expired","rejected"].includes(x.status))p.stopId=null}}

async function flatten(h,db,r,s,tok,reason,log,AS){
 await syncStops(h,db,r,s,tok);
 for(const[m,p]of Object.entries(s.pos)){
  const sym=alpSym(m),a=AS.get(sym);await cancelStop(p,tok);
  if(!(p.qty>0)||!a)continue;const q=+flr(p.qty,a);if(!(q>0))continue;
  try{const o=await order(sym,"sell",{qty:q},cid(r.id,"flat",q,Math.floor(Date.now()/HOUR),m),tok);
   s.cash+=o.quote-o.fee;p.qty-=o.exec;await h.rec(db,r,m,"sell",o,(o.price-p.avg)*o.exec-o.fee);await h.save(db,r,s)}
  catch(e){log("flatten "+r.id+" "+m,e.message)}}
 if(reason)await h.stop(db,r,reason);await h.save(db,r,s)}

export async function oneAlpaca(h,db,r,ctx){
 const{halt,candles,sandbox}=ctx,log=ctx.log||console.error,c=r.exchange_connections,tok=h.dec(c.api_key_enc);
 let s=r.live_state&&r.live_state.cash!=null?r.live_state:null;
 const hasPos=s&&Object.values(s.pos||{}).some(p=>p.qty>0);
 const active=r.live&&r.status==="active"&&!halt&&r.bots.verification==="verified";
 const AS=await rulesFor(tok);
 if(!active){
  if(hasPos){const why=r.status!=="active"?"Rental ended":halt?"Live trading halted by Tick":!r.live?null:"Bot is no longer verified";
   await flatten(h,db,r,s,tok,r.live?why:null,log,AS)}
  else if(r.live)await h.stop(db,r,halt?"Live trading halted by Tick":r.status!=="active"?"Rental ended":"Bot is no longer verified");
  return}
 const alloc=+r.allocation_usd;
 const mk=r.bots.markets.filter(m=>AS.has(alpSym(m))).slice(0,10);if(!mk.length)return h.stop(db,r,"This bot's markets are not tradable on Alpaca");
 if(!s){
  const acct=await al("GET","/account",null,tok);
  if(acct.status!=="ACTIVE"||acct.trading_blocked||acct.account_blocked)return h.stop(db,r,"Your Alpaca account is not active for trading");
  if(acct.crypto_status&&acct.crypto_status!=="ACTIVE")return h.stop(db,r,"Crypto trading is not enabled on your Alpaca account");
  if(+acct.cash<alloc)return h.stop(db,r,"Not enough free cash on Alpaca for the allocation");
  s={cash:alloc,pos:{},day:"",dayStart:alloc,peak:alloc,slot:0,errors:0}}
 const slot=Math.floor(Date.now()/HOUR);if(s.slot===slot)return;
 await syncStops(h,db,r,s,tok);
 const held=new Map((await al("GET","/positions",null,tok)).map(x=>[norm(x.symbol),+x.qty]));
 for(const[m,p]of Object.entries(s.pos)){if(!(p.qty>0))continue;const have=held.get(norm(alpSym(m)))||0;
  if(have<p.qty*0.98){await db.from("rentals").update({live:false,paused_reason:`Position mismatch on ${m}: the account holds less than Tick expected. Check for manual trades.`,live_state:{...s,pos:{}}}).eq("id",r.id);return}
  p.qty=Math.min(p.qty,have)}   // only ever trim to reality, never claim your other holdings
 const cs={},prices={};for(const m of mk){cs[m]=await candles(m);prices[m]=cs[m].at(-1).c}
 const eq=h.equityOf(s,prices),today=new Date().toISOString().slice(0,10);
 if(s.day!==today){s.day=today;s.dayStart=eq}
 s.peak=Math.max(s.peak??alloc,eq);
 if(eq<=s.dayStart*(1-r.max_daily_loss_pct/100))return flatten(h,db,r,s,tok,`Daily loss limit of ${r.max_daily_loss_pct}% reached`,log,AS);
 if(eq<=s.peak*(1-r.max_drawdown_pct/100))return flatten(h,db,r,s,tok,`Max drawdown of ${r.max_drawdown_pct}% reached`,log,AS);
 const out=await h.decide(db,r,mk,cs,sandbox,s),t=out.targets||{};
 if(JSON.stringify(out.state||{}).length<16000)s.bot_state=out.state||{};
 for(const m of mk){
  const sym=alpSym(m),a=AS.get(sym),p=(s.pos[m]??={qty:0,avg:0}),px=prices[m];
  const e=Math.max(0,Math.min(1,+t[m]||0)),d=e*eq/mk.length/px-p.qty;
  if(d>0){const spend=Math.min(d*px,s.cash*0.995),q=Math.floor(spend*100)/100;
   if(q<2||q<eq*0.01)continue;
   const o=await order(sym,"buy",{quote:q},cid(r.id,slot,m,"buy"),tok);
   p.avg=(p.qty*p.avg+o.quote)/(p.qty+o.net);p.qty+=o.net;s.cash-=o.quote;await cancelStop(p,tok);await h.rec(db,r,m,"buy",o,null);await h.save(db,r,s)}
  else if(d<0){const q=+flr(Math.min(-d,p.qty),a);
   if(!(q>0)||q*px<2)continue;
   await cancelStop(p,tok);
   const o=await order(sym,"sell",{qty:q},cid(r.id,slot,m,"sell"),tok);
   s.cash+=o.quote-o.fee;p.qty-=o.exec;await h.rec(db,r,m,"sell",o,(o.price-p.avg)*o.exec-o.fee);await h.save(db,r,s)}}
 for(const m of mk){const p=s.pos[m];if(p?.qty>0&&r.stop_loss_pct&&!p.stopId)await placeStop(alpSym(m),p,r.stop_loss_pct,prices[m],AS.get(alpSym(m)),tok,log)}
 s.slot=slot;s.errors=0;await h.save(db,r,s)}