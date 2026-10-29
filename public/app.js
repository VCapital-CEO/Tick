// Optional error monitoring: set sentryDsn in config.js. Nothing is loaded without it.
if(CFG.sentryDsn){const s=document.createElement("script");s.src="https://browser.sentry-cdn.com/8.35.0/bundle.min.js";s.crossOrigin="anonymous";
 s.onload=()=>{try{Sentry.init({dsn:CFG.sentryDsn,environment:location.hostname,tracesSampleRate:0.05})}catch{}};document.head.appendChild(s)}
const sb=window.supabase.createClient(CFG.url,CFG.key);
let MARKETS=[];const selected=new Set();
const marketsReady=sb.from("markets").select("symbol,quote_volume_24h").eq("tradable",true).order("quote_volume_24h",{ascending:false}).limit(1000).then(({data})=>{MARKETS=(data||[]).map(x=>x.symbol)});
const TYPES={trend:"Trend following",mean_reversion:"Mean reversion",grid:"Grid",arbitrage:"Arbitrage",momentum:"Momentum",other:"Other"};
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let me=null,prof=null,bots=[],feedScope="all",feedLimit=20;
function toast(t){const d=document.createElement("div");d.className="toast";d.setAttribute("role","status");d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),2600)}
async function fn(name,body){const{data:{session}}=await sb.auth.getSession();if(!session){$("auth").showModal();throw new Error("Sign in")}
 const r=await fetch(`${CFG.url}/functions/v1/${name}`,{method:"POST",headers:{"Content-Type":"application/json",apikey:CFG.key,Authorization:"Bearer "+session.access_token},body:JSON.stringify(body)});
 const j=await r.json().catch(()=>({}));if(!r.ok){toast(j.error||"Request failed");throw new Error(j.error)}return j}
async function report(type,id){const reason=prompt("What is wrong with this? (max 500 characters)");if(!reason||!me)return;await q(sb.from("reports").insert({reporter_id:me.id,target_type:type,target_id:id,reason:reason.slice(0,500)}));toast("Report sent")}
async function q(p){const{data,error}=await p;if(error){toast(error.message);throw error}return data}
const SEAL='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.4 1.8 3-.2 1 2.8 2.5 1.7-.9 2.9.9 2.9-2.5 1.7-1 2.8-3-.2L12 22l-2.4-1.8-3 .2-1-2.8-2.5-1.7.9-2.9-.9-2.9 2.5-1.7 1-2.8 3 .2z"/><path d="M8.5 12.2l2.5 2.5 4.5-5" fill="none" stroke="var(--seal-bg)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const av=(n,c)=>`<span class="av" style="background:${esc(c||"#5b717a")}">${esc((n||"?")[0]).toUpperCase()}</span>`;
const ring=(s,cls="")=>s==null?"":`<span class="ring ${cls}" style="--p:${+s}" title="Tick score ${+s} out of 100"><span>${+s}</span></span>`;
const price=b=>b.price_cents?`$${(b.price_cents/100).toFixed(b.price_cents%100?2:0)}<small>per ${b.billing_period}</small>`:`Free<small>paper and live</small>`;
const badge=v=>v==="verified"?`<span class="seal" title="Traded on live prices for 30 days, with the record kept by Tick">${SEAL}Verified</span>`:(v==="pending"||v==="running")?'<span class="badge">Verifying</span>':'<span class="badge">Not verified</span>';
const codeChip=b=>{const n=(b.code_check_notes||[]).length;return b.code_check==="passed"?'<span class="badge" title="Code scanned, behaviour-tested and backtested by Tick. This says the bot works, not that it is profitable.">Code checks passed</span>':b.code_check==="warned"?`<span class="badge" title="${esc((b.code_check_notes||[]).join(", "))}">Code checks passed, ${n} note${n===1?"":"s"}</span>`:b.code_check==="failed"?'<span class="badge">Code checks failed</span>':""};
const checkPanel=v=>{if(!v)return"";const f=(v.check_report?.findings||[]).filter(x=>x.level!=="info"),head={pending:"Queued",running:"Running",passed:"Passed",warned:"Passed with notes",failed:"Failed"}[v.check_state]||v.check_state;
 return`<h3 style="margin:0 0 6px">Code checks: ${head}</h3><p class="note" style="margin-bottom:8px">Tick scans the code, tests how it behaves on synthetic data and backtests 30 days of real prices. This shows the bot works and can be verified fairly. It says nothing about profit.</p>${f.length?`<ul class="note" style="margin:0 0 14px;padding-left:18px">${f.map(x=>`<li><b>${x.level==="block"?"Must fix":"Note"}:</b> ${esc(x.msg)}${x.line?` (line ${x.line})`:""}</li>`).join("")}</ul>`:""}`};
const stars=b=>b.review_count?`★ ${Number(b.avg_rating).toFixed(1)} <span class="by">(${b.review_count})</span>`:'<span class="by">No reviews</span>';
const num=(x,d=1)=>x==null?"–":Number(x).toFixed(d);
const sgn=x=>(x>=0?"+":"")+num(x)+"%";
function ago(t){const s=(Date.now()-new Date(t))/1000;if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+" min ago";if(s<86400)return Math.floor(s/3600)+" h ago";return new Date(t).toLocaleDateString(undefined,{month:"short",day:"numeric"})}
const BL_HEAD='<div class="bl-head"><span>Bot</span><span>Last 30 days</span><span>Return</span><span>Max drawdown</span><span>Days tracked</span><span>Rating</span><span style="text-align:right">Price</span></div>';
function sparkSVG(v){
 if(!v||v.length<2)return"";v=v.map(Number);const w=140,h=42,mn=Math.min(...v),mx=Math.max(...v),col=v.at(-1)>=v[0]?"var(--gain)":"var(--loss)";
 const l=v.map((y,i)=>(i/(v.length-1)*w).toFixed(1)+","+(h-3-(y-mn)/(mx-mn||1)*(h-6)).toFixed(1)).join(" ");
 return`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polygon points="${l} ${w},${h} 0,${h}" fill="${col}" opacity=".12"/><polyline points="${l}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`}
let chartN=0;
function areaChart(pts,{h=220,anim=false,dates=null,labels=null}={}){
 const n=pts.length;if(n<2)return"";const W=720,L=50,t=8,bm=labels?24:6,mn=Math.min(...pts),mx=Math.max(...pts),sp=(mx-mn)||1,id="g"+(++chartN),col=pts[n-1]>=pts[0]?"var(--gain)":"var(--loss)";
 const X=i=>L+i/(n-1)*(W-L),Y=v=>t+(1-(v-mn)/sp)*(h-t-bm),line=pts.map((v,i)=>X(i).toFixed(1)+","+Y(v).toFixed(1)).join(" ");
 const grid=[mn,(mn+mx)/2,mx].map(v=>`<line x1="${L}" x2="${W}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--line)" stroke-dasharray="2 5"/><text class="ax" x="0" y="${(Y(v)+5).toFixed(1)}">${(v>=100?"+":"")+(v-100).toFixed(1)}%</text>`).join("");
 const ax=labels?`<text class="ax" x="${L}" y="${h-6}">${esc(labels[0])}</text><text class="ax" x="${W}" y="${h-6}" text-anchor="end">${esc(labels[1])}</text>`:"";
 return`<div class="chart" data-pts="${pts.map(v=>v.toFixed(2)).join(",")}" data-dates="${dates?dates.map(esc).join("|"):""}" data-h="${h}" data-b="${bm}"><svg viewBox="0 0 ${W} ${h}" role="img" aria-label="Performance curve"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".24"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>${grid}<polygon points="${line} ${W},${h-bm} ${L},${h-bm}" fill="url(#${id})"/><polyline class="${anim?"draw":""}" pathLength="1" points="${line}" fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/><line class="xh" y1="${t}" y2="${h-bm}" stroke="var(--ink)" stroke-opacity=".3" visibility="hidden"/><circle class="dh" r="4.5" fill="${col}" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>${ax}</svg><div class="tip"></div></div>`}
function wireCharts(root){
 root.querySelectorAll(".chart").forEach(c=>{
  const pts=c.dataset.pts.split(",").map(Number),dates=c.dataset.dates?c.dataset.dates.split("|"):null,h=+c.dataset.h,bm=+c.dataset.b,n=pts.length,W=720,L=50,t=8;
  const mn=Math.min(...pts),mx=Math.max(...pts),sp=(mx-mn)||1,svg=c.querySelector("svg"),xh=c.querySelector(".xh"),dh=c.querySelector(".dh"),tip=c.querySelector(".tip");
  const move=ev=>{const r=svg.getBoundingClientRect(),i=Math.max(0,Math.min(n-1,Math.round((ev.clientX-r.left)/r.width*(n-1)))),x=L+i/(n-1)*(W-L),y=t+(1-(pts[i]-mn)/sp)*(h-t-bm);
   xh.setAttribute("x1",x);xh.setAttribute("x2",x);dh.setAttribute("cx",x);dh.setAttribute("cy",y);xh.setAttribute("visibility","visible");dh.setAttribute("visibility","visible");
   tip.style.left=(x/W*r.width)+"px";tip.style.top=(y/h*r.height)+"px";tip.style.opacity=1;tip.textContent=(dates?dates[i]+"   ":"")+(pts[i]>=100?"+":"")+(pts[i]-100).toFixed(2)+"%"};
  const leave=()=>{xh.setAttribute("visibility","hidden");dh.setAttribute("visibility","hidden");tip.style.opacity=0};
  svg.addEventListener("pointermove",move);svg.addEventListener("pointerleave",leave)})}
const SRC={paper:["Paper","Simulated trades on live market prices. No real money."],verified:["Verified paper","Simulated trades on live prices, run by Tick for a bot that paid for verification."],live:["Live","Real trades made by this bot for renters."]};
const srcOf=b=>SRC[b.stats_source]||SRC.paper;
const srcTag=b=>`<em class="src src-${b.stats_source||"paper"}" title="${esc(srcOf(b)[1])}">${srcOf(b)[0]}</em>`;
function kpis(b){
 if(!b.trades)return'<div class="note" style="margin:22px 0 8px;padding:18px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">No record yet. This bot starts a free paper run as soon as it passes the code checks, and numbers appear after its first trades.</div>';
 const k=(v,l,c="")=>`<div><b class="${c}">${v}</b><span>${l}</span></div>`,r=b.ret_90d;
 return`<div class="kpis">${k(sgn(r),"Return",r>=0?"pos":"neg")}${k(num(b.max_dd)+"%","Max drawdown")}${k(num(b.sharpe,2),"Sharpe ratio")}${k(num(b.win_rate,0)+"%","Winning trades")}${k(b.trades,"Trades")}${k(b.days_live,"Days of record")}</div><p class="note src-note">${srcTag(b)} ${esc(srcOf(b)[1])} Results switch to real trades once the bot trades live for a renter.</p>`}
function card(b,o={}){
 const has=b.trades>0,r=b.ret_90d,mk=b.markets.slice(0,2).map(esc).join(", ")+(b.markets.length>2?` +${b.markets.length-2}`:"");
 return`<button class="card bot" data-id="${b.id}" role="listitem"><span class="b-main"><span class="b-name">${esc(b.name)}${b.verification==="verified"?`<span class="seal" title="Verified: traded on live prices for 30 days">${SEAL}Verified</span>`:""}</span>
 <span class="b-sub">${o.noCreator?"":av(b.creator_name,b.creator_color)+`<span>${esc(b.creator_handle)}</span>`+ring(b.creator_score)}<span>${esc(TYPES[b.strategy])}</span><span>${mk}</span></span></span>
 <span class="b-spark">${b.spark&&b.spark.length>1?sparkSVG(b.spark):`<span class="b-nospark">${b.verification==="verified"?"Record building":"No record yet"}</span>`}</span>
 <span class="b-cell c1"><small>Return ${has?srcTag(b):""}</small><span class="b-num ${has?(r>=0?"pos":"neg"):""}">${has?sgn(r):"–"}</span></span>
 <span class="b-cell c2"><small>Max drawdown</small><span class="b-num">${has?num(b.max_dd)+"%":"–"}</span></span>
 <span class="b-cell c3"><small>Days tracked</small><span class="b-num">${has?b.days_live:"–"}</span></span>
 <span class="b-cell c4"><small>Rating</small><span class="b-num">${b.review_count?`★ ${Number(b.avg_rating).toFixed(1)} <span class="by">(${b.review_count})</span>`:'<span class="by">No reviews</span>'}</span></span>
 <span class="b-price">${price(b)}</span></button>`}
const skeleton=()=>Array.from({length:5},()=>'<div class="bot" aria-hidden="true" style="pointer-events:none"><span class="skel" style="height:46px;grid-column:1/-1"></span></div>').join("");

async function setUser(u){me=u||null;prof=null;
 if(me){const{data}=await sb.from("profiles").select("*").eq("id",me.id).maybeSingle();prof=data}
 $("authBtn").textContent=me?"Sign out":"Sign in";$("acct").style.display=me?"flex":"none";if(me)bell();$("navAdmin").style.display=prof&&prof.is_admin?"":"none";route()}
function logClient(e){try{window.Sentry&&Sentry.captureException(e)}catch{}if(me)sb.from("error_log").insert({source:"client",message:String(e?.message||e).slice(0,500),user_id:me.id}).then(()=>{},()=>{})}
window.addEventListener("unhandledrejection",ev=>logClient(ev.reason));
async function route(){
 const v=$("view");if(!v.innerHTML)v.innerHTML='<div class="empty">Loading…</div>';v.setAttribute("aria-busy","true");
 try{await route0()}catch(e){v.innerHTML='<div class="empty">Something went wrong. <button class="btn ghost" id="retry">Try again</button></div>';$("retry").onclick=route;logClient(e)}
 finally{v.removeAttribute("aria-busy")}}
async function route0(){
 const pm=location.pathname.match(/^\/(bots|u)\/([^/]+)/),h=(location.hash||"#/market").split("/");
 document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("tabon",b.dataset.h===(location.hash||"#/market")));
 if(pm&&pm[1]==="u")return profile(decodeURIComponent(pm[2]));
 if(h[1]==="feed")return feed();
 if(h[1]==="admin")return adminView();
 if(h[1]==="creator")return creatorView();
 if(h[1]==="rentals")return rentalsView();
 if(h[1]==="u")return profile(h[2]);
 if(h[1]==="me"){if(!prof){$("view").innerHTML='<div class="empty">Sign in to see your profile.</div>';return}return profile(prof.handle)}
 await market();if(pm&&pm[1]==="bots"){const sl=decodeURIComponent(pm[2]),b=bots.find(x=>x.slug===sl)||(await sb.from("bot_cards").select("id").eq("slug",sl).maybeSingle()).data;if(b)detail(b.id)}}

let mq={n:24};
function heroProof(b){
 if(!b)return`<div class="proof empty-proof"><b style="font:600 22px var(--serif);display:block;margin-bottom:6px">The first verified record will appear here</b><p class="mute">List a bot and run verification. Tick trades it on live prices for 30 days and publishes the result.</p></div>`;
 const v=b.spark.map(Number),pts=v.map(x=>x/v[0]*100);
 return`<div class="proof"><div class="proof-head"><div><h3>${esc(b.name)}</h3><div class="sheet-sub" style="margin-top:6px">${av(b.creator_name,b.creator_color)}<span>by ${esc(b.creator_handle)}</span>${ring(b.creator_score)}</div></div>${badge("verified")}</div>
 ${areaChart(pts,{h:230,anim:true,labels:["30 days ago","Today"]})}
 <div class="kp"><div><b class="${b.ret_90d>=0?"pos":"neg"}">${sgn(b.ret_90d)}</b><span>Return</span></div><div><b>${num(b.max_dd)}%</b><span>Max drawdown</span></div><div><b>${b.days_live}</b><span>Days of record</span></div></div>
 <div style="margin-top:18px"><button class="btn ghost" data-open="${b.id}">View the full record</button></div></div>`}
async function market(){await marketsReady;
 const proofs=["Traded on live prices for 30 days before the seal is awarded","Tick records every fill, so creators cannot edit their own results","Your key can place orders but can never withdraw funds"];
 $("view").innerHTML=`<section class="hero"><div class="hero-copy"><h1>Rent trading bots that publish their record.</h1>
 <p>Every verified bot trades on live prices while Tick keeps the books. You see the curve, the drawdown and the reviews before you pay.</p>
 <div class="hero-cta"><button class="btn big" id="browseBtn">Browse verified bots</button><button class="btn ghost big" id="listBtn">List your bot</button></div>
 <ul class="proofs">${proofs.map(p=>`<li>${CHECK}<span>${p}</span></li>`).join("")}</ul></div><div id="heroProof"><div class="skel" style="height:420px;border-radius:20px"></div></div></section>
 <div class="filterbar" id="list"><label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input id="fQ" placeholder="Search bots or creators" aria-label="Search bots or creators"></label>
 <label class="fld"><input id="fMarket" list="mlist" placeholder="Any market" aria-label="Market"><datalist id="mlist">${MARKETS.slice(0,500).map(m=>`<option value="${m}">`).join("")}</datalist></label>
 <label class="fld"><select id="fType" aria-label="Strategy"><option value="">All strategies</option>${Object.entries(TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select></label>
 <label class="toggle"><input type="checkbox" id="fVer"><i></i>Verified only</label>
 <label class="fld"><select id="fSort" aria-label="Sort"><option value="new">Newest</option><option value="ret">Best return</option><option value="rate">Best rated</option><option value="dd">Lowest drawdown</option><option value="price">Lowest price</option><option value="days">Longest record</option></select></label>
 <span class="count" id="fCount" aria-live="polite"></span></div>
 <div class="botlist" role="list">${BL_HEAD}<div id="grid">${skeleton()}</div></div><div class="more" id="moreBox"></div>`;
 sb.from("bot_cards").select("*").eq("verification","verified").not("spark","is",null).order("ret_90d",{ascending:false,nullsFirst:false}).limit(1).then(({data})=>{const el=$("heroProof");if(el){el.innerHTML=heroProof(data&&data[0]);wireCharts(el)}});
 let timer;
 const f=async more=>{if(!more)mq.n=24;
  const t=$("fQ").value.trim().replace(/[^\w .@-]/g,""),m=$("fMarket").value.trim().toUpperCase(),y=$("fType").value,v=$("fVer").checked?"verified":"",s=$("fSort").value;
  let qy=sb.from("bot_cards").select("*",{count:"exact"});
  if(t)qy=qy.or(`name.ilike.%${t}%,creator_handle.ilike.%${t}%`);
  if(MARKETS.includes(m))qy=qy.contains("markets",[m]);
  if(y)qy=qy.eq("strategy",y);if(v)qy=qy.eq("verification","verified");
  const o={new:["created_at",false],ret:["ret_90d",false],rate:["avg_rating",false],dd:["max_dd",true],price:["price_cents",true],days:["days_live",false]}[s];
  const{data,count,error}=await qy.order(o[0],{ascending:o[1],nullsFirst:false}).range(0,mq.n-1);
  if(error){toast(error.message);return}
  bots=data;$("fCount").textContent=`${count} bot${count===1?"":"s"}`;
  $("grid").innerHTML=data.length?data.map(card).join(""):'<div class="empty"><b>No bots match these filters</b>Clear a filter, or list a bot that fits.</div>';
  $("moreBox").innerHTML=count>data.length?'<button class="btn ghost" id="moreBtn">Show more bots</button>':"";
  const mb=$("moreBtn");if(mb)mb.onclick=()=>{mq.n+=24;f(true)}};
 ["fMarket","fType","fVer","fSort"].forEach(i=>$(i).onchange=()=>f());
 $("fQ").oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>f(),300)};
 await f()}

async function detail(id){
 const b=bots.find(x=>x.id===id)||await q(sb.from("bot_cards").select("*").eq("id",id).single());
 const rv=await q(sb.from("reviews").select("*,profiles(handle)").eq("bot_id",id).order("created_at",{ascending:false}));
 let rent=null;if(me){const{data}=await sb.from("rentals").select("*").eq("bot_id",id).eq("renter_id",me.id).maybeSingle();rent=data}
 const mine=me&&b.creator_id===me.id,on=rent&&rent.status==="active";
 const ver=mine?await q(sb.from("bot_versions").select("version,check_state,check_report").eq("bot_id",id).order("version",{ascending:false}).limit(1)):[],cs=ver[0]?.check_state;
 const cfg=Object.fromEntries((await q(sb.from("app_config").select("*"))).map(r=>[r.key,r.value]));
 const conns=me&&rent?await q(sb.from("exchange_connections").select("id,label,key_hint")):[];
 const live=!rent||mine?"":cfg.live_execution_enabled!=="true"?'<div class="post" style="margin:0"><b>Live trading</b><div class="note">Not enabled on Tick yet. Rentals run in paper mode.</div></div>':b.verification!=="verified"?'<div class="post" style="margin:0"><b>Live trading</b><div class="note">Only verified bots can trade live.</div></div>':prof?.kyc_status!=="verified"?'<div class="post" style="margin:0"><b>Live trading</b><div class="note">Verify your identity first: open Settings and choose Verify identity.</div></div>':rent.live?`<div class="post" style="margin:0"><b>Live trading is on</b><div class="note">Allocation $${rent.allocation_usd}. Daily loss limit ${rent.max_daily_loss_pct}%. The bot only trades the USDT you allocated, never your other holdings. Updates hourly.</div><button class="btn ghost" id="lvStop" style="margin-top:8px">Stop and sell positions</button></div>`:`<div class="post" style="margin:0"><b>Live trading</b>${rent.paused_reason?`<div class="note neg">Stopped: ${esc(rent.paused_reason)}</div>`:""}
  <div class="note">Use a Binance key with trading on and withdrawals off. Tick checks this when you save it. Limit: $${cfg.max_live_allocation_usd} per rental during the beta. You can lose money.${cfg.worker_ip?` If your key has an IP allowlist, add ${esc(cfg.worker_ip)}.`:""}</div>
  ${conns.length?`<label class="note" style="display:block;margin-top:8px">Key<select id="lvKey">${conns.map(c=>`<option value="${c.id}">${esc(c.label)} (…${esc(c.key_hint)})</option>`).join("")}</select></label>`:""}
  <details style="margin-top:8px"><summary class="note">Add a Binance key</summary><div class="two" style="margin-top:6px"><input id="kLabel" placeholder="Label" maxlength="40"><input id="kKey" placeholder="API key" autocomplete="off"></div><input id="kSecret" type="password" placeholder="API secret" autocomplete="off" style="margin-top:6px"><button class="btn ghost" id="kSave" style="margin-top:6px">Check and save key</button></details>
  <div class="two" style="margin-top:8px"><label class="note">Allocation (USDT)<input id="lvAlloc" type="number" min="10" max="${esc(cfg.max_live_allocation_usd)}" value="10"></label><label class="note">Daily loss limit (%)<input id="lvLoss" type="number" min="1" max="50" value="5"></label><label class="note">Max drawdown (%)<input id="lvDD" type="number" min="5" max="80" value="20"></label><label class="note">Stop-loss per position (%, optional)<input id="lvSL" type="number" min="1" max="50" placeholder="none"></label></div>
  <button class="btn" id="lvStart" style="margin-top:8px">Start live trading</button></div>`;
 $("detailBody").innerHTML=`<div class="sheet-top"><div><h2 tabindex="-1" id="dTitle">${esc(b.name)}</h2><div class="sheet-sub">${av(b.creator_name,b.creator_color)}<a class="lnk" href="/u/${esc(b.creator_handle)}">${esc(b.creator_handle)}</a>${ring(b.creator_score)}<span>${esc(TYPES[b.strategy])}</span><span>${stars(b)}</span></div></div>
 <div class="row" style="flex-wrap:nowrap">${codeChip(b)}${badge(b.verification)}<button class="icon" id="dClose" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>
 <div class="sheet-grid"><div class="sheet-main">
 <section><div id="eqChart"><div class="skel" style="height:260px"></div></div>${kpis(b)}</section>
 ${b.code_check==="warned"&&(b.code_check_notes||[]).length?`<section class="post"><h3 style="margin-bottom:6px">Code check notes</h3><p class="note" style="margin-bottom:8px">The code passed Tick's checks, with these observations:</p><div class="chips">${b.code_check_notes.map(x=>`<span class="chip">${esc(x)}</span>`).join("")}</div></section>`:""}
 <section><h3>About this bot</h3><p style="max-width:62ch">${esc(b.description)||"The creator has not added a description yet."}</p><div class="chips" style="margin-top:14px">${b.markets.map(x=>`<span class="chip">${esc(x)}</span>`).join("")}</div></section>
 ${rent&&!mine?`<section class="post"><h3 style="margin-bottom:10px">Leave a review</h3><div class="two"><select id="rStars" aria-label="Rating"><option value="5">5 stars</option><option value="4">4 stars</option><option value="3">3 stars</option><option value="2">2 stars</option><option value="1">1 star</option></select><input id="rText" maxlength="400" placeholder="How did it perform?" aria-label="Your review"></div><button class="btn" id="rGo" style="margin-top:12px">Post review</button></section>`:""}
 ${live?`<section>${live}</section>`:""}
 <section id="trades"></section>
 <section><h3>Reviews</h3>${rv.length?rv.map(r=>`<div class="rv"><b>${"★".repeat(r.rating)}</b> <span class="mute">${esc(r.profiles?.handle)}</span><div>${esc(r.body)}</div>${r.reply?`<div class="note" style="margin-top:4px">Creator reply: ${esc(r.reply)}</div>`:""}${mine&&!r.reply?` <button class="lnk" data-reply="${r.id}">Reply</button>`:""}${me&&r.reviewer_id===me.id?` <button class="lnk" data-editrv="${r.id}">Edit</button>`:""}</div>`).join(""):'<div class="note">No reviews yet. Renters can review after trying the bot.</div>'}</section>
 ${mine?`<section class="post">${checkPanel(ver[0])}<h3 style="margin-bottom:8px">Verification</h3><p class="note" style="margin-bottom:12px">${b.verification==="none"||b.verification==="failed"?"Every listed bot gets a free paper run on live market data, labelled Paper. Verification continues that same run for up to 30 days and awards the seal only if it passes. The fee covers the test and is paid once per bot: later versions are re-verified at no cost. It is not a guarantee.":b.verification==="verified"?"Verified. Uploading new code resets this.":"Run in progress. Stats update hourly."}</p>
 ${b.verification==="none"||b.verification==="failed"?`<button class="btn" id="dVerify" style="margin-bottom:12px"${cs==="passed"||cs==="warned"?"":" disabled"}>${cs==="pending"||cs==="running"?"Code checks running…":cs==="failed"?"Fix the code checks first":"Start verification"}</button>`:""}
 <label class="note" style="display:block">Upload new code (.py)<input id="dFile" type="file" accept=".py"></label></section>`:""}
 </div>
 <aside class="buy"><div class="price">${b.price_cents?`$${(b.price_cents/100).toFixed(b.price_cents%100?2:0)} <small>per ${b.billing_period}</small>`:"Free"}</div>
 ${mine?`<p class="note" style="margin-top:12px">This is your bot. Change its price and description under My bots.</p>`:`<button class="btn big block" id="dRent" style="margin-top:16px">${on?"Cancel rental":b.price_cents?"Rent this bot":"Try this bot free"}</button>
 <ul><li>Starts in paper mode, with no money at risk</li><li>Live trading is optional and uses your own exchange key</li><li>${b.price_cents?"Billed through Stripe. Cancel any time":"Cancel any time"}</li></ul>
 <button class="lnk" id="dReport" style="font-weight:500;color:var(--mute)">Report this bot</button>`}
 <p class="note" style="margin-top:14px">Past results do not predict future returns. Use exchange keys with trading on and withdrawals off.</p></aside></div>`;
 $("detail").showModal();$("dTitle").focus({preventScroll:true});$("dClose").onclick=()=>$("detail").close();loadCharts(id);
 const rb=$("dRent");if(rb)rb.onclick=async()=>{if(!me){$("detail").close();$("auth").showModal();return}
  if(on&&rent.stripe_subscription_id){await fn("cancel-rental",{rental_id:rent.id});toast("Ends at the end of the billing period");$("detail").close();return}
  if(!on&&cfg.payments_enabled==="true"&&b.price_cents>0){const r=await fn("rental-checkout",{bot_id:id});location.href=r.checkout_url;return}
  if(rent)await q(sb.from("rentals").update({status:on?"cancelled":"active"}).eq("id",rent.id));else await q(sb.from("rentals").insert({bot_id:id,renter_id:me.id}));
  toast(on?"Rental cancelled":"Rented "+b.name);$("detail").close()};
 const ks=$("kSave");if(ks)ks.onclick=async()=>{await fn("exchange-keys",{exchange:"binance",label:$("kLabel").value,api_key:$("kKey").value,api_secret:$("kSecret").value});toast("Key saved");detail(id)};
 const ls=$("lvStart");if(ls)ls.onclick=async()=>{const kid=$("lvKey")?.value;if(!kid){toast("Add a key first");return}
  if(!confirm("Tick's worker will place real market orders on your Binance account with the amount you allocated. You can lose some or all of it. Continue?"))return;
  await q(sb.from("rentals").update({connection_id:kid,allocation_usd:+$("lvAlloc").value,max_daily_loss_pct:+$("lvLoss").value,max_drawdown_pct:+$("lvDD").value,stop_loss_pct:$("lvSL").value?+$("lvSL").value:null,live:true,paused_reason:null}).eq("id",rent.id));toast("Live trading started");$("detail").close();route()};
 const lx=$("lvStop");if(lx)lx.onclick=async()=>{await q(sb.from("rentals").update({live:false}).eq("id",rent.id));toast("Stopping. Positions are sold within 10 minutes");$("detail").close()};
 const vb=$("dVerify");if(vb)vb.onclick=async()=>{const r=await fn("start-verification",{bot_id:id});if(r.checkout_url)location.href=r.checkout_url;else{toast("Verification started");$("detail").close();route()}};
 const df=$("dFile");if(df)df.onchange=async()=>{const fl=df.files[0];if(!fl)return;if(fl.size>200000){toast("Code file is over 200 KB");return}
  const path=`${me.id}/${id}/${Date.now()}.py`;await q(sb.storage.from("bot-code").upload(path,fl));const r=await fn("register-version",{bot_id:id,path});toast("Uploaded version "+r.version);$("detail").close();route()};
 const rp=$("dReport");if(rp)rp.onclick=()=>report("bot",id);
 document.querySelectorAll("#detailBody [data-reply]").forEach(e=>e.onclick=async()=>{const t=prompt("Your reply (max 400 characters)");if(!t)return;await q(sb.from("reviews").update({reply:t.slice(0,400)}).eq("id",e.dataset.reply));$("detail").close();detail(id)});
 document.querySelectorAll("#detailBody [data-editrv]").forEach(e=>e.onclick=async()=>{const t=prompt("Edit your review");if(!t)return;await q(sb.from("reviews").update({body:t.slice(0,400)}).eq("id",e.dataset.editrv));$("detail").close();detail(id)});
 const gb=$("rGo");if(gb)gb.onclick=async()=>{const t=$("rText").value.trim();if(!t){toast("Write a short review first");return}
  await q(sb.from("reviews").insert({bot_id:id,rental_id:rent.id,reviewer_id:me.id,rating:+$("rStars").value,body:t}));toast("Review posted");$("detail").close();route()}}

async function feed(){
 let fq=sb.from("post_feed").select("*").order("created_at",{ascending:false}).limit(feedLimit);
 if(feedScope==="following"&&me){const f=await q(sb.from("follows").select("followee_id").eq("follower_id",me.id));fq=fq.in("author_id",f.map(x=>x.followee_id).concat([me.id]))}
 const[ps,top]=await Promise.all([q(fq),q(sb.from("profiles").select("handle,display_name,color,relay_score").not("relay_score","is",null).order("relay_score",{ascending:false}).limit(5))]);
 let liked=[];if(me){liked=(await q(sb.from("post_likes").select("post_id").eq("user_id",me.id))).map(x=>x.post_id)}
 $("view").innerHTML=`<div class="phead"><div><h1>Community</h1><p>Updates from creators and renters. Be specific and be kind.</p></div><div class="seg" role="group" aria-label="Show posts from"><button class="${feedScope==="all"?"on":""}" data-fs="all">Everyone</button><button class="${feedScope==="following"?"on":""}" data-fs="following">Following</button></div></div>
 <div class="feedwrap"><div>
 ${me?`<div class="post compose"><textarea id="pText" rows="2" maxlength="280" placeholder="Share what you are building or watching" aria-label="New post"></textarea><div class="row" style="margin-top:10px"><span class="note">Up to 280 characters</span><button class="btn" id="pGo">Post</button></div></div>`:'<div class="post"><b>Join the conversation.</b> <button class="lnk" id="feedSign">Sign in</button> to post, like and comment.</div>'}
 ${ps.length?ps.map(p=>`<article class="post"><div class="who">${av(p.display_name,p.color)}<div><a class="lnk" href="/u/${esc(p.handle)}" style="color:var(--ink)">${esc(p.handle)}</a>${p.system?` <span class="seal">${SEAL}Tick</span>`:""}<div class="note">${ago(p.created_at)}</div></div></div><p>${esc(p.body)}</p>
 <div style="display:flex;gap:16px;margin-top:12px"><button class="lnk" style="color:var(--ink2)" data-like="${p.id}" aria-pressed="${liked.includes(p.id)}">${liked.includes(p.id)?"Liked":"Like"}${p.likes?` (${p.likes})`:""}</button><button class="lnk" style="color:var(--ink2)" data-cm="${p.id}">Comments</button><button class="lnk" style="color:var(--mute);font-weight:500" data-report="${p.id}">Report</button></div><div id="cm-${p.id}"></div></article>`).join(""):'<div class="empty"><b>Nothing here yet</b>Post an update to start the conversation.</div>'}
 ${ps.length>=feedLimit?'<div class="more"><button class="btn ghost" id="moreFeed">Show more posts</button></div>':""}</div>
 <aside class="sidebox"><h3>Top creators</h3>${top.map(t=>`<div class="lead">${av(t.display_name,t.color)}<div style="flex:1;min-width:0"><a class="lnk" href="/u/${esc(t.handle)}" style="color:var(--ink)">${esc(t.display_name)}</a><div class="note">@${esc(t.handle)}</div></div>${ring(t.relay_score)}</div>`).join("")||'<div class="note">Scores appear once creators have verified, rated bots.</div>'}<p class="note" style="margin-top:14px">Tick score blends renter ratings, verified bots and live record.</p></aside></div>`;
 document.querySelectorAll("[data-cm]").forEach(b=>b.onclick=()=>comments(b.dataset.cm));
 document.querySelectorAll("[data-fs]").forEach(b=>b.onclick=()=>{feedScope=b.dataset.fs;feedLimit=20;feed()});
 const mf=$("moreFeed");if(mf)mf.onclick=()=>{feedLimit+=20;feed()};
 const fsg=$("feedSign");if(fsg)fsg.onclick=()=>$("auth").showModal();
 document.querySelectorAll("[data-report]").forEach(e=>e.onclick=()=>me?report("post",e.dataset.report):$("auth").showModal());
 const g=$("pGo");if(g)g.onclick=async()=>{const t=$("pText").value.trim();if(t){await q(sb.from("posts").insert({author_id:me.id,body:t}));feed()}};
 document.querySelectorAll("[data-like]").forEach(e=>e.onclick=async()=>{if(!me){$("auth").showModal();return}const id=e.dataset.like;
  await q(liked.includes(id)?sb.from("post_likes").delete().eq("post_id",id).eq("user_id",me.id):sb.from("post_likes").insert({post_id:id,user_id:me.id}));feed()})}

async function profile(handle){
 const p=await q(sb.from("profiles").select("*").eq("handle",handle).maybeSingle());
 if(!p){$("view").innerHTML='<div class="empty"><b>Profile not found</b>Check the handle and try again.</div>';return}
 const mine=prof&&prof.id===p.id;
 const fo=me&&!mine?((await sb.from("follows").select("followee_id").eq("follower_id",me.id).eq("followee_id",p.id)).data||[]).length>0:false;
 const bs=await q(sb.from("bot_cards").select("*").eq("creator_id",p.id));bots=bs;
 const rv=await q(sb.from("reviews").select("*,profiles(handle),bots!inner(name,creator_id)").eq("bots.creator_id",p.id).order("created_at",{ascending:false}).limit(30));
 $("view").innerHTML=`<div class="p-head">${av(p.display_name,p.color)}<div style="flex:1;min-width:240px"><h1>${esc(p.display_name)}</h1><div class="by" style="margin-top:6px">@${esc(p.handle)}${p.kyc_status==="verified"?'<em class="src src-verified" title="Government ID checked by Stripe">ID verified</em>':""}</div><p style="margin-top:10px;max-width:56ch;color:var(--ink2)">${esc(p.bio)||"No bio yet."}</p>${me&&!mine?`<button class="btn ${fo?"ghost":""}" id="folBtn" style="margin-top:14px">${fo?"Following":"Follow"}</button>`:""}</div>
 <div class="score-box">${p.relay_score==null?'<span class="ring lg" style="--p:0"><span>–</span></span>':ring(p.relay_score,"lg")}<div><b style="font:600 19px var(--serif)">Tick score</b><p class="note" style="max-width:26ch;margin-top:4px">Renter ratings, verified bots and live record. Updated nightly.</p></div></div></div>
 ${mine?`<details class="post"><summary style="cursor:pointer;font-weight:600">Edit profile</summary><div class="two" style="margin-top:14px"><label>Display name<input id="eName" value="${esc(p.display_name)}" maxlength="40"></label><label>Colour<input id="eColor" type="color" value="${esc(p.color)}" style="padding:3px;height:44px"></label></div><label style="display:block;margin-top:12px">Bio<textarea id="eBio" rows="2" maxlength="140">${esc(p.bio)}</textarea></label><div style="margin-top:14px"><button class="btn" id="eSave">Save profile</button></div></details>`:""}
 <h2 class="sec-title">Bots</h2><div class="botlist" role="list">${bs.length?BL_HEAD+bs.map(x=>card(x,{noCreator:true})).join(""):'<div class="empty"><b>No bots listed yet</b>Bots this creator lists will show up here.</div>'}</div>
 <h2 class="sec-title">Reviews</h2>${rv.length?rv.map(r=>`<div class="rv"><b>${"★".repeat(r.rating)}</b> <span class="mute">on ${esc(r.bots.name)} by ${esc(r.profiles?.handle)}</span><div>${esc(r.body)}</div></div>`).join(""):'<div class="note">No reviews yet.</div>'}`;
 const fb=$("folBtn");if(fb)fb.onclick=async()=>{await q(fo?sb.from("follows").delete().eq("follower_id",me.id).eq("followee_id",p.id):sb.from("follows").insert({follower_id:me.id,followee_id:p.id}));profile(handle)};
 const s=$("eSave");if(s)s.onclick=async()=>{await q(sb.from("profiles").update({display_name:$("eName").value.trim()||p.display_name,bio:$("eBio").value.trim(),color:$("eColor").value}).eq("id",p.id));toast("Profile saved");setUser(me)}}

function init(){
 $("nav").onclick=e=>{const h=e.target.closest("button")?.dataset.h;if(h){history.pushState(null,"","/"+h);route()}};
 window.onhashchange=route;
 $("view").onclick=e=>{const c=e.target.closest(".card"),o=e.target.closest("[data-open]");if(c)detail(c.dataset.id);if(o)detail(o.dataset.open);if(e.target.id==="browseBtn")$("list").scrollIntoView({behavior:"smooth"});if(e.target.id==="listBtn"){me?$("upload").showModal():$("auth").showModal()}};
 $("authBtn").onclick=()=>me?sb.auth.signOut():$("auth").showModal();
 $("aCancel").onclick=()=>$("auth").close();
 const auth=async up=>{const email=$("aEmail").value.trim(),password=$("aPass").value;
  const{error}=up?await sb.auth.signUp({email,password,options:{captchaToken}}):await sb.auth.signInWithPassword({email,password,options:{captchaToken}});
  if(window.turnstile&&CFG.turnstileKey){turnstile.reset();captchaToken=null}
  if(error){toast(error.message);return}if(!up&&!(await mfaGate()))return;$("auth").close();toast(up?"Check your email if confirmation is on":"Signed in")};
 $("aGoogle").onclick=async()=>{if(!$("aAgree").checked){toast("Please accept the terms first");return}const{error}=await sb.auth.signInWithOAuth({provider:"google",options:{redirectTo:location.origin}});if(error)toast(error.message)};
 $("aIn").onclick=()=>auth(false);$("aUp").onclick=()=>{if(!$("aAgree").checked){toast("Please accept the terms first");return}auth(true)};
 $("uType").innerHTML=Object.entries(TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join("");
 marketsReady.then(pickerInit);
 $("uCancel").onclick=()=>$("upload").close();
 $("uSubmit").onclick=publishListing;

 $("detail").addEventListener("click",e=>{if(e.target===$("detail"))$("detail").close()});
 sb.auth.onAuthStateChange((ev,s)=>{if(ev==="PASSWORD_RECOVERY")$("reset").showModal();setUser(s?.user)});
}
init();

async function adminView(){
 if(!prof||!prof.is_admin){$("view").innerHTML='<div class="empty">Not allowed.</div>';return}
 const rs=await q(sb.from("reports").select("*").eq("state","open").order("created_at"));
 const st=await q(sb.rpc("admin_stats")),au=await q(sb.from("audit_log").select("*").order("created_at",{ascending:false}).limit(15));
 const mins=st.beat?Math.round((Date.now()-new Date(st.beat))/60000):null,on=st.live_enabled==="true";
 const panel=`<div class="post"><div class="stats"><div class="stat"><b>${st.users}</b><span>Users</span></div><div class="stat"><b>${st.bots}</b><span>Bots</span></div><div class="stat"><b>${st.live}</b><span>Live rentals</span></div></div>
 <p style="margin-top:14px" class="${mins===null||mins>30?"neg":"pos"}"><b>Worker</b> ${mins===null?"never seen":mins+" min since last beat"}</p>
 <p>Live trading is <b>${on?"ON":"OFF"}</b>. <button class="btn ${on?"danger":"ghost"}" id="killBtn">${on?"Halt live trading":"Enable live trading"}</button></p>
 <details><summary class="note">Admin log</summary>${au.map(x=>`<div class="rv">${esc(x.action)} <span class="note">${new Date(x.created_at).toLocaleString()}</span></div>`).join("")||'<div class="note">Empty</div>'}</details></div>`;
 const ids=t=>rs.filter(r=>r.target_type===t).map(r=>r.target_id),tbl={bot:["bots","name"],post:["posts","body"],review:["reviews","body"],profile:["profiles","handle"]},txt={};
 for(const t of Object.keys(tbl)){if(ids(t).length){const d=await q(sb.from(tbl[t][0]).select("*").in("id",ids(t)));d.forEach(x=>txt[x.id]=x)}}
 $("view").innerHTML=`<div class="phead"><div><h1>Moderation</h1><p class="mute">${rs.length} open report${rs.length===1?"":"s"}</p></div></div>${panel}
 ${rs.length?rs.map(r=>{const t=txt[r.target_id];return`<div class="post"><div class="row"><b>${esc(r.target_type)}</b><span class="note">${new Date(r.created_at).toLocaleString()}</span></div>
 <p>${t?esc(t[tbl[r.target_type][1]]):"(already removed)"}</p><p class="note">Reason: ${esc(r.reason)}</p>
 <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" data-act="dismiss" data-id="${r.id}">Dismiss</button><button class="btn" data-act="remove" data-id="${r.id}" data-t="${r.target_type}" data-tid="${r.target_id}">${r.target_type==="bot"?"Delist":r.target_type==="profile"?"Ban user":"Delete"}</button></div></div>`}).join(""):'<div class="empty">Nothing to review.</div>'}`;
 await adminExtra();
 $("killBtn").onclick=async()=>{if(on&&!confirm("Halt live trading? The worker will sell every live position within 10 minutes."))return;await q(sb.rpc("admin_set_flag",{k:"live_execution_enabled",v:on?"false":"true"}));adminView()};
 document.querySelectorAll("[data-act]").forEach(b=>b.onclick=async()=>{const d=b.dataset;
  if(d.act==="remove"){if(d.t==="bot")await q(sb.from("bots").update({listed:false}).eq("id",d.tid));
   else if(d.t==="post")await q(sb.from("posts").delete().eq("id",d.tid));
   else if(d.t==="review")await q(sb.from("reviews").delete().eq("id",d.tid));
   else await q(sb.rpc("admin_set_ban",{target:d.tid,banned:true}))}
  await q(sb.from("reports").update({state:d.act==="remove"?"actioned":"dismissed"}).eq("id",d.id));adminView()})}

// ---- Minimum requirements for an uploaded bot -------------------------------------------------------------------------
// Quick checks in the browser (the server and worker repeat them; these just fail fast and show progress).
const ALLOWED_IMPORTS=["math","statistics","collections","itertools","functools","heapq","bisect","decimal","fractions","dataclasses","typing","enum","operator","numpy","pandas","relay_ta","random","datetime","copy","__future__"];
function reqChecks(name,size,text){
 const out=[],add=(id,label,ok,msg)=>out.push({id,label,ok,msg:ok?"":msg});
 add("type","A Python file (.py) under 200 KB",/\.py$/i.test(name)&&size>0&&size<=200000,!/\.py$/i.test(name)?"The file must end in .py":size>200000?"The file is over 200 KB":"The file is empty");
 const textOk=typeof text==="string"&&!text.includes("\u0000")&&!text.includes("�");
 add("text","Readable source code, not binary data",textOk,"This is not a plain text source file");
 const code=textOk?text.replace(/#.*$/gm,"").replace(/"""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\'|"[^"\n]*"|\'[^\'\n]*\'/g,'""'):"";
 const m=code.match(/^def\s+decide\s*\(([^)]*)\)/m),params=m?m[1].split(",").map(x=>x.trim()).filter(Boolean).length:0;
 add("decide","Defines decide(candles, markets)",!!m&&params>=2&&params<=3,!m?"No top-level function named decide was found":"decide must take (candles, markets) or (candles, markets, state)");
 const bad=[];for(const l of code.split("\n")){const a=l.match(/^\s*import\s+(.+)/),b=l.match(/^\s*from\s+([\w.]+)\s+import/);
  if(a)a[1].split(",").forEach(x=>{const r=x.trim().split(/\s+as\s+/)[0].split(".")[0];if(r&&!ALLOWED_IMPORTS.includes(r))bad.push(r)});
  if(b){const r=b[1].split(".")[0];if(!ALLOWED_IMPORTS.includes(r))bad.push(r)}}
 add("imports","Uses only allowed libraries",!bad.length,`Not allowed: ${[...new Set(bad)].join(", ")}. Allowed: ${ALLOWED_IMPORTS.filter(x=>x!=="__future__").join(", ")}`);
 const calls=[...new Set((code.match(/\b(exec|eval|compile|__import__|open|input|getattr|setattr|delattr|globals|locals|vars|breakpoint)\s*\(/g)||[]).map(x=>x.replace(/\s*\($/,"")))];
 add("calls","No file access, eval or reflection",!calls.length,`Not allowed: ${calls.join(", ")}`);
 return out}
window.tickReq=reqChecks;
const SERVER_STEPS=[["upload","Uploaded to Tick"],["accept","Accepted by the server"],["static","Full code scan"],["probe","Behaviour tests on simulated markets"],["backtest","30-day backtest on real prices"]];
const ICON={wait:"○",run:"",ok:"✓",fail:"✕",warn:"!"};
function drawReq(rows){$("uReq").hidden=false;$("uReq").innerHTML=`<div class="req-h">Minimum requirements</div><ul class="req">${rows.map(r=>`<li class="req-${r.state}"><span class="req-i" aria-hidden="true">${ICON[r.state]}</span><span><b>${esc(r.label)}</b>${r.msg?`<span class="req-m">${esc(r.msg)}</span>`:""}</span></li>`).join("")}</ul>`}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let publishing=false;
async function publishListing(){
 if(publishing)return;
 const name=$("uName").value.trim(),mk=[...selected],p=Math.round(parseFloat($("uPrice").value)*100),fl=$("uFile").files[0];
 if(name.length<2||!mk.length||!(p>=0)){toast("Add a name, a price and at least one market");return}
 if(!fl){toast("Choose your bot's .py file. A listing needs code that passes the checks");return}
 publishing=true;const btn=$("uSubmit");btn.disabled=true;btn.textContent="Checking…";
 const rows=[],set=(id,state,msg="")=>{const r=rows.find(x=>x.id===id);if(r){r.state=state;r.msg=msg;drawReq(rows)}};
 let draft=null;
 try{
  const text=await fl.text().catch(()=>null),local=reqChecks(fl.name,fl.size,text);
  local.forEach(c=>rows.push({id:c.id,label:c.label,state:"wait",msg:""}));SERVER_STEPS.forEach(([id,label])=>rows.push({id,label,state:"wait",msg:""}));drawReq(rows);
  for(const c of local){set(c.id,"run");await sleep(220);set(c.id,c.ok?"ok":"fail",c.msg);if(!c.ok)throw new Error("requirements")}
  set("upload","run");
  draft=await q(sb.from("bots").insert({creator_id:me.id,slug:name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")+"-"+Math.random().toString(36).slice(2,6),name,description:$("uDesc").value.trim(),strategy:$("uType").value,markets:mk,price_cents:p,billing_period:$("uBill").value,listed:false,pending_listing:true}).select("id").single());
  const path=`${me.id}/${draft.id}/${Date.now()}.py`;await q(sb.storage.from("bot-code").upload(path,fl));set("upload","ok");
  set("accept","run");let reg;try{reg=await fn("register-version",{bot_id:draft.id,path})}catch(e){set("accept","fail",e.message||"Rejected by the server");throw new Error("requirements")}
  set("accept","ok");
  // The worker reports progress through bot_versions.check_stage; follow it until the checks finish.
  const order=["static","probe","backtest"];let final=null;const t0=Date.now();set("static","run");
  while(Date.now()-t0<600000){
   await sleep(2500);
   const{data:v}=await sb.from("bot_versions").select("check_state,check_stage,check_report").eq("bot_id",draft.id).eq("version",reg.version).maybeSingle();if(!v)continue;
   const at=order.indexOf(v.check_stage);order.forEach((id,k)=>{if(at>k)set(id,"ok");else if(at===k||(at<0&&k===0))set(id,"run")});
   if(["passed","warned","failed"].includes(v.check_state)){final=v;break}}
  if(!final){order.forEach(id=>set(id,"wait"));drawReq(rows);$("uReq").insertAdjacentHTML("beforeend",'<p class="note">The checker is busy or offline. Your draft is saved, unlisted, under My bots, and it will be listed automatically once it passes.</p>');draft=null;publishing=false;btn.disabled=false;btn.textContent="Publish listing";return}
  const f=(final.check_report?.findings||[]).filter(x=>x.level!=="info"),bi=order.indexOf((f.find(x=>x.level==="block")||{}).source);
  order.forEach((id,k)=>{const fs=f.filter(x=>x.source===id),b=fs.find(x=>x.level==="block"),w=fs.find(x=>x.level==="warn");
   set(id,b?"fail":w?"warn":(bi>=0&&k>bi)?"wait":"ok",(b||w)?b?b.msg:w.msg:(bi>=0&&k>bi)?"Skipped":"")});
  if(final.check_state==="failed"){throw new Error("requirements")}
  await q(sb.from("bots").update({listed:true}).eq("id",draft.id));draft=null;
  toast("Listing published");await sleep(900);$("upload").close();["uName","uDesc","uMSearch","uFile"].forEach(i=>$(i).value="");selected.clear();pickerInit();$("uReq").hidden=true;route()
 }catch(e){
  // A bot that fails any requirement is never listed: remove the draft so retries do not pile up.
  if(draft)await sb.from("bots").delete().eq("id",draft.id);
  if(e.message!=="requirements")toast(e.message||"Something went wrong");
  else $("uReq").insertAdjacentHTML("beforeend",'<p class="note">Fix the items marked ✕ and choose the file again. Nothing was listed.</p>');
 }finally{publishing=false;btn.disabled=false;btn.textContent="Publish listing"}}

function pickerInit(){const dl=$("uMData"),sel=$("uMSel"),srch=$("uMSearch");
 const drawSel=()=>{sel.innerHTML=[...selected].map(m=>`<span class="chip">${esc(m)} <button class="lnk" data-x="${esc(m)}" aria-label="Remove ${esc(m)}">×</button></span>`).join("")};
 const fill=()=>{const t=srch.value.trim().toUpperCase();dl.innerHTML=MARKETS.filter(m=>!selected.has(m)&&(!t||m.includes(t))).slice(0,60).map(m=>`<option value="${m}"></option>`).join("")};
 const add=m=>{srch.value="";if(selected.has(m))return;if(selected.size>=10){toast("Up to 10 markets per bot");return}selected.add(m);drawSel();fill()};
 // Exact symbol, or a bare base like BTC, or a single partial match.
 const find=t=>{t=t.trim().toUpperCase();if(!t)return null;const c=MARKETS.filter(m=>m.includes(t));return MARKETS.find(m=>m===t)||MARKETS.find(m=>m===t+"/USDT")||(c.length===1?c[0]:null)};
 srch.oninput=()=>{fill();const t=srch.value.trim().toUpperCase();if(MARKETS.includes(t))add(t)};
 srch.onkeydown=e=>{if(e.key!=="Enter")return;e.preventDefault();const m=find(srch.value);if(m)add(m);else if(srch.value.trim())toast("No tradable market matches that")};
 sel.onclick=e=>{const m=e.target.dataset.x;if(m){selected.delete(m);drawSel();fill()}};
 drawSel();fill()}

const poly=(v,w,h,mn,mx)=>v.map((y,i)=>`${(i/(v.length-1)*w).toFixed(1)},${(h-4-(y-mn)/(mx-mn||1)*(h-8)).toFixed(1)}`).join(" ");
async function loadCharts(id){
 const el=$("eqChart");
 const eq=await q(sb.from("equity_snapshots").select("ts,equity").eq("bot_id",id).order("ts").limit(1500));
 if(el){
  if(eq.length>1){
   const v=eq.map(x=>+x.equity/+eq[0].equity*100);let pk=v[0],dd=0;const d=v.map(x=>{pk=Math.max(pk,x);const r=(x-pk)/pk*100;dd=Math.min(dd,r);return r});
   const dates=eq.map(x=>new Date(x.ts).toLocaleDateString(undefined,{month:"short",day:"numeric"}));
   el.innerHTML=`${areaChart(v,{h:260,anim:true,dates,labels:[dates[0],dates.at(-1)]})}<div class="note" style="margin:12px 0 4px">Drawdown: the worst drop from a peak was ${dd.toFixed(1)}%</div><svg viewBox="0 0 720 56" style="width:100%;height:56px;display:block" aria-label="Drawdown chart"><polygon points="${poly(d,720,56,Math.min(...d)||-1,0)} 720,0 0,0" fill="var(--loss)" opacity=".22"/></svg>`;
   wireCharts(el)}
  else el.innerHTML='<div class="empty" style="padding:40px 0"><b>No curve yet</b>The record builds hourly once a verification run starts.</div>'}
 const fl=await q(sb.from("fills").select("market,side,qty,price,realized_pnl,ts").eq("bot_id",id).order("ts",{ascending:false}).limit(15));
 if(fl.length&&$("trades"))$("trades").innerHTML=`<h3>Recent trades</h3><div style="overflow-x:auto"><table class="trades">${fl.map(f=>`<tr><td>${new Date(f.ts).toLocaleString()}</td><td>${esc(f.market)}</td><td class="${f.side==="buy"?"pos":"neg"}">${f.side}</td><td>${Number(f.qty).toPrecision(5)}</td><td>${Number(f.price).toPrecision(6)}</td><td class="${f.realized_pnl>=0?"pos":"neg"}">${f.realized_pnl==null?"":Number(f.realized_pnl).toFixed(2)}</td></tr>`).join("")}</table></div>`}

async function creatorView(){
 if(!prof){$("view").innerHTML='<div class="empty"><b>Sign in to manage your bots</b>Creators list bots, verify them and set their own prices.<div style="margin-top:14px"><button class="btn" id="needSign">Sign in</button></div></div>';$("needSign").onclick=()=>$("auth").showModal();return}
 const bs=await q(sb.from("bots").select("*").eq("creator_id",prof.id).order("created_at",{ascending:false})),ids=bs.map(b=>b.id);let vs=[],runs=[],cnt=[],st=[];
 const cfg=Object.fromEntries((await q(sb.from("app_config").select("*"))).map(r=>[r.key,r.value])),pay=await q(sb.from("profiles").select("payouts_enabled").eq("id",prof.id).single()),bts=ids.length?await q(sb.from("backtests").select("*").in("bot_id",ids).order("created_at",{ascending:false})):[];
 if(ids.length)[vs,runs,cnt,st]=await Promise.all([q(sb.from("bot_versions").select("bot_id,version").in("bot_id",ids)),q(sb.from("verification_runs").select("bot_id,state,ends_at,result,created_at").in("bot_id",ids).order("created_at",{ascending:false})),q(sb.rpc("my_bot_rentals")),q(sb.from("bot_stats").select("*").in("bot_id",ids))]);
 const per=b=>b.billing_period==="week"?4.33:1,renters=cnt.reduce((n,c)=>n+ +c.active,0),gross=bs.reduce((n,b)=>{const c=cnt.find(x=>x.bot_id===b.id);return n+(c?+c.active:0)*b.price_cents/100*per(b)},0);
 $("view").innerHTML=`<div class="phead"><div><h1>My bots</h1><p>Set prices, track results and keep your listings healthy.</p></div><button class="btn" id="listBtn">List a bot</button></div>
 <div class="kpis k4" style="margin-top:0"><div><b>${bs.length}</b><span>Bots listed</span></div><div><b>${bs.filter(b=>b.verification==="verified").length}</b><span>Verified</span></div><div><b>${renters}</b><span>Active renters</span></div><div><b>$${gross.toFixed(0)}</b><span>Estimated monthly gross</span></div></div>
 ${cfg.payments_enabled==="true"?`<div class="post">${pay.payouts_enabled?'<b>Payouts are active.</b> Rental income goes to your Stripe account, minus the platform fee. <button class="btn ghost" id="earnBtn" style="margin-left:6px">Show earnings</button><div id="earn"></div>':'<b>Get paid.</b> Connect a Stripe account to receive rental income. <button class="btn" id="connBtn" style="margin-left:6px">Connect Stripe</button>'}</div>`:""}
 ${bs.length?bs.map(b=>{const v=vs.filter(x=>x.bot_id===b.id).sort((x,y)=>y.version-x.version),r=runs.find(x=>x.bot_id===b.id),c=cnt.find(x=>x.bot_id===b.id),s=st.find(x=>x.bot_id===b.id),act=c?+c.active:0,bt=bts.find(x=>x.bot_id===b.id);
 return`<section class="post bot-panel" data-bot="${b.id}"><div class="row"><div><h3>${esc(b.name)}</h3><div class="note" style="margin-top:4px">${v.length?`Code version ${v[0].version}`:"No code uploaded yet"}, ${act} active renter${act===1?"":"s"}${c&&+c.live?` (${c.live} live)`:""}${b.listed?"":", delisted"}</div></div>${badge(b.verification)}</div>
 <div class="bp-grid"><div>
  ${s?`<div class="kpis sm"><div><b class="${s.ret_90d>=0?"pos":"neg"}">${sgn(s.ret_90d)}</b><span>Return</span></div><div><b>${num(s.max_dd)}%</b><span>Max drawdown</span></div><div><b>${s.trades}</b><span>Trades</span></div></div>`:'<p class="note" style="margin:14px 0">No record yet. A free paper run starts once your bot passes the code checks.</p>'}
  ${r?`<p class="note">Latest run: ${esc(r.state)}${r.result?.fails?.length?". "+esc(r.result.fails.join("; ")):""}${r.state==="running"?`, ends ${new Date(r.ends_at).toLocaleDateString()}`:""}</p>`:""}
  <div class="bt"><b>Backtest</b>${bt?(bt.state==="done"?`<p class="note" style="margin:4px 0 8px">${bt.result.days} days, simulated: return ${num(bt.result.ret)}%, drawdown ${num(bt.result.dd)}%, Sharpe ${num(bt.result.sharpe,2)}, ${bt.result.trades} trades. Historical and not verified; beware overfitting.</p>${bt.result.consistent===false?`<p class="note neg" style="margin-bottom:8px">Warning: the second half did much worse than the first (${num(bt.result.halves.first.ret)}% vs ${num(bt.result.halves.second.ret)}%). This pattern often means overfitting.</p>`:""}<svg viewBox="0 0 300 60" preserveAspectRatio="none" style="width:100%;height:60px;display:block" aria-label="Backtest curve"><polyline points="${poly(bt.result.equity,300,60,Math.min(...bt.result.equity),Math.max(...bt.result.equity))}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`:bt.state==="failed"?`<p class="note neg">Backtest failed: ${esc(bt.error)}</p>`:`<p class="note">Backtest ${esc(bt.state)}. Check back in a minute.</p>`):'<p class="note" style="margin:4px 0 8px">Test the bot on recent history before you pay for verification.</p>'}
  ${v.length?`<button class="btn ghost" data-bt="${b.id}" style="margin-top:10px">Run a 30-day backtest</button>`:""}</div>
 </div><div class="bp-form"><label style="display:block;margin-bottom:12px">Name<input data-f="name" maxlength="40" value="${esc(b.name)}"></label><div class="two"><label>Price (USD)<input data-f="price" type="number" min="0" step="0.01" value="${b.price_cents/100}"></label><label>Billing<select data-f="bill"><option value="month" ${b.billing_period==="month"?"selected":""}>Per month</option><option value="week" ${b.billing_period==="week"?"selected":""}>Per week</option></select></label></div>
  <label style="display:block;margin-top:12px">Description<textarea data-f="desc" rows="3" maxlength="600">${esc(b.description)}</textarea></label>
  <p class="note" style="margin-top:12px">${b.verification_paid?"Verification is paid for. New code versions are re-verified at no cost.":"Replacing the code starts the code checks again."}</p>
  <div class="actions"><button class="btn" data-save="${b.id}">Save changes</button><label class="btn ghost" style="cursor:pointer">Replace code<input type="file" accept=".py" data-replace="${b.id}" hidden></label><button class="btn ghost" data-editcode="${b.id}" data-name="${esc(b.name)}">Edit code</button><button class="btn ghost" data-list="${b.id}" data-on="${b.listed}">${b.listed?"Delist":"List again"}</button><a class="btn ghost" href="/bots/${esc(b.slug)}">Open public page</a><button class="btn ghost neg" data-delbot="${b.id}">Delete bot</button></div></div></div></section>`}).join(""):'<div class="empty"><b>You have not listed a bot yet</b>List one, run a backtest, then verify it to earn the seal.</div>'}`;
 const eb=$("earnBtn");if(eb)eb.onclick=async()=>{const r=await fn("creator-earnings",{}),$$=x=>(x.amount/100).toFixed(2)+" "+String(x.currency).toUpperCase();
  $("earn").innerHTML=`<div class="note" style="margin-top:10px">Available ${(r.available||[]).map($$).join(", ")||"0"}. Pending ${(r.pending||[]).map($$).join(", ")||"0"}.</div>${(r.payouts||[]).map(p=>`<div class="rv">Payout ${$$(p)}, ${esc(p.status)}, ${new Date(p.arrival*1000).toLocaleDateString()}</div>`).join("")||'<div class="note">No payouts yet.</div>'}<details><summary class="note">Recent transactions</summary>${(r.transactions||[]).map(t=>`<div class="rv">${new Date(t.created*1000).toLocaleDateString()}, ${esc(t.type)}, net ${(t.net/100).toFixed(2)} (fee ${(t.fee/100).toFixed(2)})</div>`).join("")}</details>`};
 const cn=$("connBtn");if(cn)cn.onclick=async()=>{const r=await fn("connect-onboard",{});location.href=r.url};
 document.querySelectorAll("[data-bt]").forEach(b=>b.onclick=async()=>{await q(sb.from("backtests").insert({bot_id:b.dataset.bt,creator_id:prof.id,days:30}));toast("Backtest queued");creatorView()});
 document.querySelectorAll("[data-save]").forEach(b=>b.onclick=async()=>{const box=b.closest("[data-bot]"),g=f=>box.querySelector(`[data-f=${f}]`).value;
  const nm=g("name").trim();if(!nm){toast("Give the bot a name");return}
  await q(sb.from("bots").update({name:nm,price_cents:Math.round(parseFloat(g("price"))*100),billing_period:g("bill"),description:g("desc")}).eq("id",box.dataset.bot));toast("Changes saved");creatorView()});
 document.querySelectorAll("[data-list]").forEach(b=>b.onclick=async()=>{await q(sb.from("bots").update({listed:b.dataset.on!=="true"}).eq("id",b.dataset.list));creatorView()});
 document.querySelectorAll("[data-replace]").forEach(i=>i.onchange=async()=>{const fl=i.files[0];i.value="";if(fl)await submitCode(i.dataset.replace,fl)});
 document.querySelectorAll("[data-editcode]").forEach(b=>b.onclick=()=>editCode(b.dataset.editcode,b.dataset.name));
 document.querySelectorAll("[data-delbot]").forEach(b=>b.onclick=async()=>{if(!confirm("Delete this bot permanently? Its record, reviews and code will be removed. This cannot be undone."))return;
  try{await fn("delete-bot",{bot_id:b.dataset.delbot});toast("Bot deleted");creatorView()}catch(e){toast(e.message)}})}
// Uploads new code for an existing bot as the next version. The server and the worker check it again.
async function submitCode(botId,file){
 if(file.size>200000){toast("Code file is over 200 KB");return}
 const text=await file.text();if(!/^def\s+decide\s*\(/m.test(text)){toast("The bot must define a top-level function: def decide(candles, markets)");return}
 try{const path=`${me.id}/${botId}/${Date.now()}.py`;await q(sb.storage.from("bot-code").upload(path,file));const r=await fn("register-version",{bot_id:botId,path});toast(`Version ${r.version} uploaded. The code checks are running.`);creatorView()}catch(e){toast(e.message)}}
async function editCode(botId,name){
 const{data:v}=await sb.from("bot_versions").select("storage_path").eq("bot_id",botId).order("version",{ascending:false}).limit(1);
 if(!v?.length){toast("This bot has no code yet. Use Replace code to upload a file.");return}
 const{data:blob,error}=await sb.storage.from("bot-code").download(v[0].storage_path);if(error){toast("Could not load the code");return}
 $("ceName").textContent="Edit code: "+name;$("ceText").value=await blob.text();$("codeEdit").showModal();
 $("ceCancel").onclick=()=>$("codeEdit").close();
 $("ceSave").onclick=async()=>{const t=$("ceText").value;$("codeEdit").close();await submitCode(botId,new File([t],"bot.py",{type:"text/x-python"}))}}

async function rentalsView(){
 if(!prof){$("view").innerHTML='<div class="empty"><b>Sign in to see your rentals</b>Rentals, results and exchange keys live here.<div style="margin-top:14px"><button class="btn" id="needSign">Sign in</button></div></div>';$("needSign").onclick=()=>$("auth").showModal();return}
 const rs=await q(sb.from("rentals").select("*,bots(name,slug,verification)").eq("renter_id",prof.id).order("started_at",{ascending:false}));
 const keys=await q(sb.from("exchange_connections").select("id,label,key_hint,created_at"));
 const fl=rs.length?await q(sb.from("fills").select("rental_id,realized_pnl").in("rental_id",rs.map(r=>r.id))):[];
 $("view").innerHTML=`<div class="phead"><div><h1>My rentals</h1><p>Status, results and exchange keys for every bot you rent.</p></div><a class="btn ghost" href="/#/market">Browse bots</a></div>
 ${rs.length?rs.map(r=>{const f=fl.filter(x=>x.rental_id===r.id),pnl=f.reduce((n,x)=>n+(+x.realized_pnl||0),0),ls=r.live_state||{},pos=Object.values(ls.pos||{}).filter(p=>p.qty>0).length;
 return`<section class="post"><div class="row"><div><h3><a href="/bots/${esc(r.bots.slug)}" style="text-decoration:none">${esc(r.bots.name)}</a></h3><div class="note" style="margin-top:4px">Rented ${new Date(r.started_at).toLocaleDateString()}, ${r.price_cents?`$${(r.price_cents/100).toFixed(2)} per ${r.billing_period}`:"free"}${r.cancel_at_period_end?", ends at period end":""}</div></div><span class="badge ${r.live?"live":""}">${r.status==="cancelled"?"Cancelled":r.live?"Live":"Paper"}</span></div>
 ${r.paused_reason?`<p class="neg" style="margin-top:12px;font-weight:500">Stopped: ${esc(r.paused_reason)}</p>`:""}
 ${ls.cash!=null?`<div class="kpis sm" style="margin-top:16px"><div><b>${r.allocation_usd?"$"+num(r.allocation_usd,0):"Paper"}</b><span>Allocation</span></div><div><b>$${num(ls.cash,2)}</b><span>Cash</span></div><div><b>${pos}</b><span>Open position${pos===1?"":"s"}</span></div><div><b class="${pnl>=0?"pos":"neg"}">${pnl>=0?"+":"-"}$${Math.abs(pnl).toFixed(2)}</b><span>Realized profit, ${f.length} trades</span></div></div>`:""}
 <div class="actions">${r.live?`<button class="btn ghost" data-stop="${r.id}">Stop live trading</button>`:""}${r.status==="active"?`<button class="btn ghost" data-cancel="${r.id}">Cancel rental</button>`:""}</div></section>`}).join(""):'<div class="empty"><b>You are not renting any bots</b>Try one in paper mode first. It costs nothing and shows how the bot behaves.<div style="margin-top:14px"><a class="btn" href="/#/market">Browse the marketplace</a></div></div>'}
 <h2 class="sec-title">Exchange keys</h2>${keys.length?keys.map(k=>`<div class="post row"><span><b>${esc(k.label)}</b> <span class="mute">ends in ${esc(k.key_hint)}, added ${new Date(k.created_at).toLocaleDateString()}</span></span><button class="btn ghost" data-delkey="${k.id}">Remove</button></div>`).join(""):'<div class="note">No keys saved. You can add one from the page of a bot you rent.</div>'}
 <h2 class="sec-title">Invoices</h2><button class="btn ghost" id="invBtn">Show invoices</button><div id="inv"></div>`;
 document.querySelectorAll("[data-stop]").forEach(b=>b.onclick=async()=>{await q(sb.from("rentals").update({live:false}).eq("id",b.dataset.stop));toast("Stopping. Positions are sold within 10 minutes");rentalsView()});
 document.querySelectorAll("[data-cancel]").forEach(b=>b.onclick=async()=>{if(!confirm("Cancel this rental? Any live positions will be sold."))return;const rr=rs.find(x=>x.id===b.dataset.cancel);if(rr.stripe_subscription_id){await fn("cancel-rental",{rental_id:rr.id});toast("Ends at the end of the billing period")}else await q(sb.from("rentals").update({status:"cancelled",live:false}).eq("id",rr.id));rentalsView()});
 const ib=$("invBtn");if(ib)ib.onclick=async()=>{const r=await fn("my-invoices",{});$("inv").innerHTML=(r.invoices||[]).map(i=>`<div class="rv">${new Date(i.created*1000).toLocaleDateString()}, ${esc(i.number||"invoice")}, ${(i.amount/100).toFixed(2)} ${String(i.currency).toUpperCase()}, ${esc(i.status)} ${i.url?`<a class="lnk" href="${esc(i.url)}" target="_blank" rel="noopener">View</a>`:""}</div>`).join("")||'<div class="note" style="margin-top:10px">No invoices yet.</div>'};
 document.querySelectorAll("[data-delkey]").forEach(b=>b.onclick=async()=>{await q(sb.from("exchange_connections").delete().eq("id",b.dataset.delkey));rentalsView()})}

async function bell(){const{count}=await sb.from("notifications").select("id",{count:"exact",head:true}).eq("read",false);$("bellN").textContent=count?(count>9?"9+":count):""}
setInterval(()=>{if(me)bell()},60000);
function init2(){
 $("bellBtn").onclick=async()=>{const ns=await q(sb.from("notifications").select("*").order("created_at",{ascending:false}).limit(30));
  $("notifBody").innerHTML=ns.length?ns.map(n=>`<div class="rv" style="${n.read?"":"font-weight:600"}">${esc(n.body)}${n.link?` <a class="lnk" href="${esc(n.link)}">Open</a>`:""}<div class="note">${new Date(n.created_at).toLocaleString()}</div></div>`).join(""):'<div class="note">No alerts yet.</div>';
  $("notif").showModal();if(ns.some(n=>!n.read)){await sb.from("notifications").update({read:true}).eq("read",false);bell()}};
 $("notifClose").onclick=()=>$("notif").close();$("setBtn").onclick=async()=>{mfaBox();kycBox();const{data}=await sb.from("profiles").select("email_alerts").eq("id",me.id).single();$("setEmail").checked=!!data?.email_alerts;$("settings").showModal()};$("setEmail").onchange=async()=>{await q(sb.from("profiles").update({email_alerts:$("setEmail").checked}).eq("id",me.id));toast("Saved")};$("setClose").onclick=()=>$("settings").close();
 const newPass=async(id,done)=>{const p=$(id).value;if(p.length<8){toast("Use at least 8 characters");return}const{error}=await sb.auth.updateUser({password:p});if(error){toast(error.message);return}$(id).value="";done();toast("Password updated")};
 $("setPass").onclick=()=>newPass("setNew",()=>{});$("rGoPass").onclick=()=>newPass("rNew",()=>$("reset").close());
 $("setDel").onclick=async()=>{if($("setConfirm").value!=="DELETE"){toast("Type DELETE to confirm");return}await fn("delete-account",{});await sb.auth.signOut();$("settings").close();toast("Account deleted")};
 $("aForgot").onclick=async()=>{const email=$("aEmail").value.trim();if(!email){toast("Enter your email first");return}const{error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin,captchaToken});if(window.turnstile&&CFG.turnstileKey){turnstile.reset();captchaToken=null}toast(error?error.message:"Check your email for a reset link")}}
init2();

async function comments(id){const box=$("cm-"+id);if(box.dataset.open){box.innerHTML="";delete box.dataset.open;return}box.dataset.open="1";
 const cs=await q(sb.from("comments").select("*,profiles(handle)").eq("post_id",id).order("created_at"));
 box.innerHTML=`${cs.map(c=>`<div class="rv"><b>${esc(c.profiles?.handle)}</b> ${esc(c.body)}</div>`).join("")||'<div class="note">No comments yet.</div>'}${me?`<div class="two" style="margin-top:6px;grid-template-columns:1fr auto"><input id="ci-${id}" maxlength="280" placeholder="Write a comment"><button class="btn" id="cb-${id}">Send</button></div>`:""}`;
 const cb=$("cb-"+id);if(cb)cb.onclick=async()=>{const t=$("ci-"+id).value.trim();if(!t)return;await q(sb.from("comments").insert({post_id:id,author_id:me.id,body:t}));delete box.dataset.open;comments(id)}}

let captchaToken=null;
(function(){if(!CFG.turnstileKey)return;const s=document.createElement("script");s.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";s.onload=()=>turnstile.render("#captcha",{sitekey:CFG.turnstileKey,callback:t=>{captchaToken=t}});document.head.appendChild(s)})();

async function mfaGate(){
 const{data:l}=await sb.auth.mfa.getAuthenticatorAssuranceLevel();
 if(!(l&&l.nextLevel==="aal2"&&l.currentLevel!=="aal2"))return true;
 const f=(await sb.auth.mfa.listFactors()).data?.totp?.[0],code=f&&prompt("Enter your 6-digit authenticator code");
 if(!code){await sb.auth.signOut();toast("Two-factor code required");return false}
 const ch=await sb.auth.mfa.challenge({factorId:f.id}),v=await sb.auth.mfa.verify({factorId:f.id,challengeId:ch.data.id,code});
 if(v.error){await sb.auth.signOut();toast("Wrong code");return false}return true}
const KYC={none:"Not verified",pending:"In review",failed:"Not verified: last attempt failed",verified:"Verified"};
async function kycBox(){
 const box=$("kycBox");if(!box||!me)return;
 const{data}=await sb.from("profiles").select("kyc_status").eq("id",me.id).single(),st=data?.kyc_status||"none";
 box.innerHTML=`<div class="note" style="margin-top:14px"><b>Identity</b>: ${KYC[st]}. ${st==="verified"?"Your ID is verified. Tick keeps only the result, never your documents.":"Verification uses a government ID and a selfie, handled by Stripe. It is required before live trading."}</div>${st==="verified"||st==="pending"?"":`<button class="btn ghost" id="kycGo" style="margin-top:8px">Verify identity</button>`}`;
 const go=$("kycGo");if(go)go.onclick=async()=>{go.disabled=true;const r=await fn("kyc-start",{});if(r.url)location.href=r.url;else{go.disabled=false}}}
async function mfaBox(){
 const box=$("mfaBox"),f=(await sb.auth.mfa.listFactors()).data?.totp?.find(x=>x.status==="verified");
 box.innerHTML=f?'<div class="note">Two-factor sign-in is on. It is also required to start live trading.</div><button class="btn ghost" id="mfaOff">Turn off</button>':'<button class="btn ghost" id="mfaOn">Turn on two-factor sign-in</button>';
 const off=$("mfaOff");if(off)off.onclick=async()=>{const{error}=await sb.auth.mfa.unenroll({factorId:f.id});toast(error?error.message:"Two-factor turned off");mfaBox()};
 const on=$("mfaOn");if(on)on.onclick=async()=>{const{data,error}=await sb.auth.mfa.enroll({factorType:"totp"});if(error){toast(error.message);return}
  box.innerHTML=`<div class="note">Scan this with an authenticator app, or enter the key by hand: <b>${esc(data.totp.secret)}</b></div><img alt="QR code for two-factor setup" src="${esc(data.totp.qr_code)}" width="160" height="160"><div class="two" style="grid-template-columns:1fr auto"><input id="mfaCode" inputmode="numeric" maxlength="6" placeholder="6-digit code"><button class="btn" id="mfaGo">Confirm</button></div>`;
  $("mfaGo").onclick=async()=>{const ch=await sb.auth.mfa.challenge({factorId:data.id}),v=await sb.auth.mfa.verify({factorId:data.id,challengeId:ch.data.id,code:$("mfaCode").value.trim()});toast(v.error?v.error.message:"Two-factor is on");mfaBox()}}}

async function adminExtra(){
 const[tk,fl,er]=await Promise.all([q(sb.from("support_tickets").select("*").eq("state","open").order("created_at").limit(20)),
  q(sb.from("code_flags").select("*,a:bots!code_flags_bot_id_fkey(name),b:bots!code_flags_other_bot_id_fkey(name)").eq("state","open").limit(20)),
  q(sb.from("error_log").select("*").order("created_at",{ascending:false}).limit(15))]);
 $("view").insertAdjacentHTML("beforeend",`<div class="post"><h3>Find a user</h3><div class="two" style="grid-template-columns:1fr auto"><input id="auQ" placeholder="Handle, name or email (3+ characters)"><button class="btn" id="auGo">Search</button></div><div id="auOut"></div></div>
 <div class="post"><h3>Review a bot's code</h3><div class="two" style="grid-template-columns:1fr auto"><input id="cvSlug" placeholder="Bot slug, from its page URL"><button class="btn" id="cvGo">View code</button></div></div>
 <div class="post"><h3>Refund</h3><div class="two" style="grid-template-columns:1fr auto"><input id="rfPi" placeholder="Stripe payment intent id (pi_...)"><button class="btn ghost" id="rfGo">Refund in full</button></div></div>
 <div class="post"><h3>Support tickets (${tk.length})</h3>${tk.map(t=>`<div class="rv"><b>${esc(t.subject)}</b><br>${esc(t.message)}<br><button class="lnk" data-tk="${t.id}">Close ticket</button></div>`).join("")||'<div class="note">None open.</div>'}</div>
 <div class="post"><h3>Similar-code flags (${fl.length})</h3>${fl.map(f=>`<div class="rv">${esc(f.a?.name)} is ${Math.round(f.similarity*100)}% similar to ${esc(f.b?.name)} <button class="lnk" data-cvid="${f.bot_id}">View</button> <button class="lnk" data-cvid="${f.other_bot_id}">View other</button> <button class="lnk" data-fl="${f.id}">Dismiss</button></div>`).join("")||'<div class="note">None.</div>'}</div>
 <div class="post"><h3>Recent errors</h3>${er.map(e=>`<div class="rv"><span class="note">${esc(e.source)} · ${new Date(e.created_at).toLocaleString()}</span><br>${esc(e.message)} ${esc(e.detail||"")}</div>`).join("")||'<div class="note">None.</div>'}</div>`);
 const showCode=async id=>{const r=await fn("admin-tools",{action:"code",bot_id:id});$("cvName").textContent=r.name;$("cvCode").textContent=r.code;$("codeView").showModal()};
 $("cvClose").onclick=()=>$("codeView").close();
 document.querySelectorAll("[data-cvid]").forEach(b=>b.onclick=()=>showCode(b.dataset.cvid));
 document.querySelectorAll("[data-fl]").forEach(b=>b.onclick=async()=>{await q(sb.from("code_flags").update({state:"dismissed"}).eq("id",b.dataset.fl));adminView()});
 document.querySelectorAll("[data-tk]").forEach(b=>b.onclick=async()=>{await q(sb.from("support_tickets").update({state:"closed"}).eq("id",b.dataset.tk));adminView()});
 $("cvGo").onclick=async()=>{const{data}=await sb.from("bots").select("id").eq("slug",$("cvSlug").value.trim()).maybeSingle();if(!data){toast("No bot with that slug");return}showCode(data.id)};
 $("rfGo").onclick=async()=>{if(!confirm("Refund this payment in full?"))return;const r=await fn("admin-tools",{action:"refund",payment_intent:$("rfPi").value.trim()});toast("Refund "+r.status)};
 $("auGo").onclick=async()=>{const r=await fn("admin-tools",{action:"users",q:$("auQ").value});
  $("auOut").innerHTML=r.users.map(u=>`<div class="rv">${esc(u.handle)} · ${esc(u.email||"")} · ${u.is_banned?"banned":"active"} <button class="lnk" data-ban="${u.id}" data-to="${!u.is_banned}">${u.is_banned?"Unban":"Ban"}</button></div>`).join("")||'<div class="note">No match.</div>';
  document.querySelectorAll("[data-ban]").forEach(b=>b.onclick=async()=>{await q(sb.rpc("admin_set_ban",{target:b.dataset.ban,banned:b.dataset.to==="true"}));$("auGo").click()})}}

function init3(){
 $("supBtn").onclick=()=>me?$("support").showModal():$("auth").showModal();
 $("supCancel").onclick=()=>$("support").close();
 $("supSend").onclick=async()=>{await q(sb.from("support_tickets").insert({user_id:me.id,subject:$("supSub").value.trim(),message:$("supMsg").value.trim()}));$("support").close();["supSub","supMsg"].forEach(i=>$(i).value="");toast("Sent. We will reply by email")};
 try{const sp=new URLSearchParams(location.search);if(sp.get("kyc")==="done"||sp.get("verification")){toast(sp.get("kyc")?"Thanks. Your identity check is being reviewed.":sp.get("verification")==="paid"?"Payment received. Verification starts shortly.":"Checkout cancelled");history.replaceState(null,"",location.pathname+location.hash)}}catch{}
 try{if(!localStorage.getItem("relay_seen")){$("welcome").showModal();$("welcomeOk").onclick=()=>{$("welcome").close();localStorage.setItem("relay_seen","1")}}}catch{}
}
init3();