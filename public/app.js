// Optional error monitoring: set sentryDsn in config.js. Nothing is loaded without it.
if(CFG.sentryDsn){const s=document.createElement("script");s.src="https://browser.sentry-cdn.com/8.35.0/bundle.min.js";s.crossOrigin="anonymous";
 s.onload=()=>{try{Sentry.init({dsn:CFG.sentryDsn,environment:location.hostname,tracesSampleRate:0.05})}catch{}};document.head.appendChild(s)}
// Some browsers return a null Navigator lock during Supabase session refresh.
// Keep auth usable across alternate accounts instead of repeatedly retrying the lock.
const authLock=async(_name,_timeout,callback)=>callback();
const sb=window.supabase.createClient(CFG.url,CFG.key,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:"tick-auth",lock:authLock}});
try{navigator.storage&&navigator.storage.persist&&navigator.storage.persist()}catch{}  // ask the browser not to evict the saved sign-in
let MARKETS=[];const selected=new Set();
const marketsReady=sb.from("markets").select("symbol,quote_volume_24h").eq("tradable",true).order("quote_volume_24h",{ascending:false}).limit(1000).then(({data})=>{MARKETS=(data||[]).map(x=>x.symbol)});
const TYPES={trend:"Trend following",mean_reversion:"Mean reversion",grid:"Grid",arbitrage:"Arbitrage",momentum:"Momentum",other:"Other"};
const $=id=>document.getElementById(id);
// Stable compatibility wrapper: route can call this before the rental renderer appears later in the file.
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let me=null,prof=null,bots=[],feedScope="all",feedLimit=20;
function toast(t){const d=document.createElement("div");d.className="toast";d.setAttribute("role","status");d.textContent=t;document.body.appendChild(d);setTimeout(()=>d.remove(),2600)}
async function fn(name,body){const{data:{session}}=await sb.auth.getSession();if(!session){$("auth").showModal();throw new Error("Sign in")}
 const r=await fetch(`${CFG.url}/functions/v1/${name}`,{method:"POST",headers:{"Content-Type":"application/json",apikey:CFG.key,Authorization:"Bearer "+session.access_token},body:JSON.stringify(body)});
 const j=await r.json().catch(()=>({}));if(!r.ok){const msg=j.error||`Request failed (${r.status})`;toast(msg);throw new Error(msg)}return j}
async function report(type,id){const reason=prompt("What is wrong with this? (max 500 characters)");if(!reason||!me)return;await q(sb.from("reports").insert({reporter_id:me.id,target_type:type,target_id:id,reason:reason.slice(0,500)}));toast("Report sent")}
async function q(p){const{data,error}=await p;if(error){toast(error.message);throw error}return data}
const SEAL='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.4 1.8 3-.2 1 2.8 2.5 1.7-.9 2.9.9 2.9-2.5 1.7-1 2.8-3-.2L12 22l-2.4-1.8-3 .2-1-2.8-2.5-1.7.9-2.9-.9-2.9 2.5-1.7 1-2.8 3 .2z"/><path d="M8.5 12.2l2.5 2.5 4.5-5" fill="none" stroke="var(--seal-bg)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHECK='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const av=(n,c,img)=>img?`<span class="av avatar-img" style="background-image:url(${esc(img)})" role="img" aria-label="${esc(n||"Profile photo")}"></span>`:`<span class="av" style="background:${esc(c||"#5b717a")}">${esc((n||"?")[0]).toUpperCase()}</span>`;
const ring=(s,cls="")=>s==null?"":`<span class="ring ${cls}" style="--p:${+s}" title="Tick score ${+s} out of 100"><span>${+s}</span></span>`;
const scoreChip=s=>s==null?"":`<span class="score-mini" title="Tick score ${Math.round(+s)} of 100">${Math.round(+s)}</span>`;
const price=b=>b.price_cents?`$${(b.price_cents/100).toFixed(b.price_cents%100?2:0)}<small>per ${b.billing_period}</small>`:`Free<small>paper and live</small>`;
const badge=v=>v==="verified"?`<span class="seal" title="Traded on live prices for 30 days, with the record kept by Tick">${SEAL}Verified</span>`:(v==="pending"||v==="running")?'<span class="badge">Verifying</span>':'<span class="badge">Not verified</span>';
const codeChip=b=>{const n=(b.code_check_notes||[]).length;return b.code_check==="passed"?'<span class="badge" title="Code scanned, behaviour-tested and backtested by Tick. This says the bot works, not that it is profitable.">Code checks passed</span>':b.code_check==="warned"?`<span class="badge" title="${esc((b.code_check_notes||[]).join(", "))}">Code checks passed, ${n} note${n===1?"":"s"}</span>`:b.code_check==="failed"?'<span class="badge">Code checks failed</span>':""};
const checkPanel=v=>{if(!v)return"";const f=(v.check_report?.findings||[]).filter(x=>x.level!=="info"),head={pending:"Queued",running:"Running",passed:"Passed",warned:"Passed with notes",failed:"Failed"}[v.check_state]||v.check_state;
 return`<h3 style="margin:0 0 6px">Code checks: ${head}</h3><p class="note" style="margin-bottom:8px">Tick scans the code, tests how it behaves on synthetic data and backtests 30 days of real prices. This shows the bot works and can be verified fairly. It says nothing about profit.</p>${f.length?`<ul class="note" style="margin:0 0 14px;padding-left:18px">${f.map(x=>`<li><b>${x.level==="block"?"Must fix":"Note"}:</b> ${esc(x.msg)}${x.line?` (line ${x.line})`:""}</li>`).join("")}</ul>`:""}`};
const stars=b=>b.review_count?`★ ${Number(b.avg_rating).toFixed(1)} <span class="by">(${b.review_count})</span>`:'<span class="by">No reviews</span>';
const num=(x,d=1)=>x==null?"–":Number(x).toFixed(d);
const sgn=x=>(x>=0?"+":"")+num(x)+"%";
function ago(t){const s=(Date.now()-new Date(t))/1000;if(s<60)return"just now";if(s<3600)return Math.floor(s/60)+" min ago";if(s<86400)return Math.floor(s/3600)+" h ago";return new Date(t).toLocaleDateString(undefined,{month:"short",day:"numeric"})}
const BL_HEAD='<div class="bl-head" aria-hidden="true"><span>Bot</span><span>30-day record</span><span>Return</span><span>Drawdown</span><span>Days</span><span>Rating</span><span style="text-align:right">Price</span></div>';
function sparkSVG(v){
 if(!v||v.length<2)return"";v=v.map(Number);const w=140,h=42,mn=Math.min(...v),mx=Math.max(...v),col=v.at(-1)>=v[0]?"var(--gain)":"var(--loss)";
 const l=v.map((y,i)=>(i/(v.length-1)*w).toFixed(1)+","+(h-3-(y-mn)/(mx-mn||1)*(h-6)).toFixed(1)).join(" ");
 return`<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polygon points="${l} ${w},${h} 0,${h}" fill="${col}" opacity=".12"/><polyline points="${l}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`}
let chartN=0;
function areaChart(pts,{h=220,w=720,anim=false,dates=null,labels=null}={}){
 const n=pts.length;if(n<2)return"";
 const W=w,L=58,R=4,t=12,bm=labels?30:12,mn=Math.min(...pts),mx=Math.max(...pts),sp=(mx-mn)||1,id="g"+(++chartN),col=pts[n-1]>=pts[0]?"var(--gain)":"var(--loss)";
 const lo=mn-sp*.09,hi=mx+sp*.09,X=i=>L+i/(n-1)*(W-L-R),Y=v=>t+(1-(v-lo)/(hi-lo))*(h-t-bm),line=pts.map((v,i)=>X(i).toFixed(1)+","+Y(v).toFixed(1)).join(" ");
 const grid=[mx,(mn+mx)/2,mn].map(v=>`<line x1="${L}" x2="${W-R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--line)" stroke-dasharray="2 6"/><text class="ax" x="${L-10}" y="${(Y(v)+3.5).toFixed(1)}" text-anchor="end">${(v>=100?"+":"")+(v-100).toFixed(1)}%</text>`).join("");
 const base=`<line x1="${L}" x2="${W-R}" y1="${h-bm}" y2="${h-bm}" stroke="var(--line-2)" stroke-opacity=".8"/>`;
 const ax=labels?`<text class="ax" x="${L}" y="${h-8}">${esc(labels[0])}</text><text class="ax" x="${W-R}" y="${h-8}" text-anchor="end">${esc(labels[1])}</text>`:"";
 return`<div class="chart" data-pts="${pts.map(v=>v.toFixed(2)).join(",")}" data-dates="${dates?dates.map(esc).join("|"):""}" data-h="${h}" data-b="${bm}" data-w="${W}"><svg viewBox="0 0 ${W} ${h}" role="img" aria-label="Performance curve"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".28"/><stop offset=".8" stop-color="${col}" stop-opacity=".02"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>${grid}${base}<polygon points="${line} ${W-R},${h-bm} ${L},${h-bm}" fill="url(#${id})"/><polyline class="${anim?"draw":""}" pathLength="1" points="${line}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><line class="xh" y1="${t}" y2="${h-bm}" stroke="var(--ink)" stroke-opacity=".28" visibility="hidden"/><circle class="dh" r="4" fill="${col}" stroke="var(--surface)" stroke-width="2" visibility="hidden"/>${ax}</svg><div class="tip"></div></div>`}
function wireCharts(root){
 root.querySelectorAll(".chart").forEach(c=>{
  const pts=c.dataset.pts.split(",").map(Number),dates=c.dataset.dates?c.dataset.dates.split("|"):null,h=+c.dataset.h,bm=+c.dataset.b,n=pts.length,W=+c.dataset.w||720,L=58,R=4,t=12;
  const mn=Math.min(...pts),mx=Math.max(...pts),sp=(mx-mn)||1,lo=mn-sp*.09,hi=mx+sp*.09,svg=c.querySelector("svg"),xh=c.querySelector(".xh"),dh=c.querySelector(".dh"),tip=c.querySelector(".tip");
  const move=ev=>{const r=svg.getBoundingClientRect(),i=Math.max(0,Math.min(n-1,Math.round((ev.clientX-r.left)/r.width*(n-1)))),x=L+i/(n-1)*(W-L-R),y=t+(1-(pts[i]-lo)/(hi-lo))*(h-t-bm);
   xh.setAttribute("x1",x);xh.setAttribute("x2",x);dh.setAttribute("cx",x);dh.setAttribute("cy",y);xh.setAttribute("visibility","visible");dh.setAttribute("visibility","visible");
   tip.style.left=(x/W*r.width)+"px";tip.style.top=(y/h*r.height)+"px";tip.style.opacity=1;tip.textContent=(dates?dates[i]+"   ":"")+(pts[i]>=100?"+":"")+(pts[i]-100).toFixed(2)+"%"};
  const leave=()=>{xh.setAttribute("visibility","hidden");dh.setAttribute("visibility","hidden");tip.style.opacity=0};
  svg.addEventListener("pointermove",move);svg.addEventListener("pointerleave",leave)})}
const STAFF_EMAILS=new Set(["innovationwithwesley@gmail.com"]);
const isStaff=()=>!!me&&STAFF_EMAILS.has(String(me.email||"").toLowerCase());
const SRC={paper:["Paper","Simulated trades on live market prices. No real money."],verified:["Verified paper","Simulated trades on live prices, run by Tick for a bot that paid for verification."],live:["Live","Real trades made by this bot for renters."]};
const srcOf=b=>SRC[b.stats_source]||SRC.paper;
const srcTag=b=>`<em class="src src-${b.stats_source||"paper"}" title="${esc(srcOf(b)[1])}">${srcOf(b)[0]}</em>`;
function kpis(b){
 const useSample=b.verification!=="verified"&&b.backtest?.result;
 if(useSample){const r=b.backtest.result;return`<div class="kpis historical"><div><b class="${r.ret>=0?"pos":"neg"}">${sgn(r.ret)}</b><span>30d simulated return</span></div><div><b>${num(r.dd)}%</b><span>Drawdown</span></div><div><b>${num(r.sharpe,2)}</b><span>Sharpe</span></div><div><b>${r.trades}</b><span>Trades</span></div></div><p class="note src-note">Historical backtest only; not verified and not a live trading record.</p>`}
 if(!b.trades)return'<div class="note" style="margin:22px 0 8px;padding:18px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)">No record yet. This bot starts a free paper run as soon as it passes the code checks, and numbers appear after its first trades.</div>';
 const k=(v,l,c="")=>`<div><b class="${c}">${v}</b><span>${l}</span></div>`,r=b.ret_90d;
 return`<div class="kpis">${k(sgn(r),"Return",r>=0?"pos":"neg")}${k(num(b.max_dd)+"%","Max drawdown")}${k(num(b.sharpe,2),"Sharpe ratio")}${k(num(b.win_rate,0)+"%","Winning trades")}${k(b.trades,"Trades")}${k(b.days_live,"Days of record")}</div><p class="note src-note">${srcTag(b)} ${esc(srcOf(b)[1])} Results switch to real trades once the bot trades live for a renter.</p>`}
const CTA=`<span class="bot-cta">Rent<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>`;
function card(b,o={}){
 const sample=b.verification!=="verified"&&b.backtest?.result;
 const has=b.trades>0&&!sample,r=Number(b.ret_90d)||0,hot=has&&r>=20;
 const ver=b.verification==="verified"?`<span class="seal" title="Verified: traded on live prices for 30 days">${SEAL}Verified</span>`:(b.verification==="running"||b.verification==="pending")?`<span class="badge">Verifying</span>`:`<span class="badge">Not verified</span>`;
 const rating=b.review_count?`<span class="bot-dot"></span><span class="bot-stars"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 6.6 7.2.9-5.3 4.9 1.3 7.1L12 18l-6.2 3.5 1.3-7.1L1.8 9.5 9 8.6z"/></svg>${Number(b.avg_rating).toFixed(1)}</span>`:"";
 if(!has)return `<button class="bot card cold" data-id="${b.id}" role="listitem">
  <span class="bot-top"><span class="bot-tags">${ver}</span><span class="bot-score" style="--p:${Math.round(Number(b.creator_score)||0)}" title="Creator score"><b>${Math.round(Number(b.creator_score)||0)}</b></span></span>
  <span class="bot-name">${esc(b.name)}</span>
  <span class="bot-meta">${o.noCreator?"":av(b.creator_name,b.creator_color)+`<span class="bot-handle">@${esc(b.creator_handle)}</span>`}</span>
  <span class="bot-empty">${b.backtest?.result?backtestSummary(b.backtest):`<b>${b.verification==="verified"?"Building its record":"No record yet"}</b><span>${b.verification==="verified"?"Verified. Numbers appear after the first trades.":"A free 30-day paper run starts once the code checks pass."}</span>`}</span>
  <span class="bot-foot"><span class="bot-price free"><b>Free</b><span>paper</span></span>${CTA}</span>
 </button>`;
 return `<button class="bot card${hot?" hot":""}" data-id="${b.id}" role="listitem">
  <span class="bot-top"><span class="bot-tags">${ver}${hot?'<span class="badge hot">Hot</span>':""}</span><span class="bot-score" style="--p:${Math.round(Number(b.creator_score)||0)}" title="Creator score ${Math.round(Number(b.creator_score)||0)} of 100"><b>${Math.round(Number(b.creator_score)||0)}</b><i>score</i></span></span>
  <span class="bot-name">${esc(b.name)}</span>
  <span class="bot-meta">${o.noCreator?"":av(b.creator_name,b.creator_color)+`<span class="bot-handle">@${esc(b.creator_handle)}</span>`}${rating}</span>
  <span class="bot-perf"><span class="bot-ret ${has?(r>=0?"pos":"neg"):"empty"}">${has?`<span class="arrow">${r>=0?"&#9650;":"&#9660;"}</span>${sgn(r)}`:"&mdash;"}</span><span class="bot-ret-label">${has?"90-day return":"No record yet"}</span>
   <span class="bot-spark">${b.spark&&b.spark.length>1?sparkSVG(b.spark):`<span class="bot-nospark">${b.verification==="verified"?"Building record":"Paper run pending"}</span>`}</span></span>
  <span class="bot-stats"><span><b>${has?num(b.max_dd)+"%":"&mdash;"}</b><span>max DD</span></span><span><b>${has?b.days_live:"&mdash;"}</b><span>days</span></span><span><b>${has?b.trades:"&mdash;"}</b><span>trades</span></span></span>
  <span class="bot-foot"><span class="bot-price ${b.price_cents?"":"free"}">${b.price_cents?`<b>$${(b.price_cents/100).toFixed(b.price_cents%100?0:0)}</b><span>/${b.billing_period==="week"?"wk":"mo"}</span>`:"<b>Free</b><span>paper</span>"}</span>${CTA}</span>
 </button>`}
const skeleton=()=>`<div class="grid-skel" aria-hidden="true">${Array.from({length:6},()=>'<div class="skel"></div>').join("")}</div>`;
async function refreshBell(){const el=$("bellN");if(!el)return;try{const{count,error}=await sb.from("notifications").select("id",{count:"exact",head:true}).eq("read",false);if(error){el.textContent="";return}el.textContent=count?(count>9?"9+":count):""}catch{el.textContent=""}}

async function setUser(u){me=u||null;prof=null;
 if(me){const{data}=await sb.from("profiles").select("*").eq("id",me.id).maybeSingle();prof=data}
 $("authBtn").textContent=me?"Sign out":"Sign in";$("acct").style.display=me?"flex":"none";if(me)void refreshBell();$("navAdmin").style.display=isStaff()?"":"none";const adminSheet=document.querySelector('#navSheet button[data-h="#/admin"]');if(adminSheet)adminSheet.style.display=isStaff()?"":"none";route()}
async function safeRows(query){const{data,error}=await query;return error?[]:(data||[])}
async function attachBacktests(rows){
 const ids=(rows||[]).map(x=>x.id).filter(Boolean);if(!ids.length)return rows||[];
 const all=await safeRows(sb.from("bot_public_backtests").select("*").in("bot_id",ids).order("created_at",{ascending:false}));
 const latest=new Map();(all||[]).forEach(x=>{if(!latest.has(x.bot_id))latest.set(x.bot_id,x)});
 return (rows||[]).map(x=>({...x,backtest:latest.get(x.id)||null}));
}
function backtestSummary(bt){const r=bt?.result;if(!r)return"";return`<span class="backtest-mini"><b>${num(r.ret)}%</b><span>30d simulated</span><em>DD ${num(r.dd)}% · Sharpe ${num(r.sharpe,2)} · ${r.trades} trades</em></span>`}
function logClient(e){
 try{if(window.Sentry)Sentry.captureException(e)}catch{}
 // Do not write error_log from the browser: older deployments may not have the
 // table/policy, and a failed diagnostic insert must never create a second error.
}
window.addEventListener("unhandledrejection",ev=>logClient(ev.reason));
let navSeq=0,groupCache=null,groupCacheAt=0,groupCacheUser="";
async function route(){
 const seq=++navSeq;window.__navSeq=seq;
 const v=$("view");if(!v.children.length)v.innerHTML=skeleton();v.setAttribute("aria-busy","true");
 try{await route0()}catch(e){if(seq!==window.__navSeq)return;const msg=String(e?.message||"");v.innerHTML=`<div class="empty"><b>Something went wrong.</b>${msg?`<p class="note" style="margin-top:8px">${esc(msg)}</p>`:""}<button class="btn ghost" id="retry" style="margin-top:14px">Try again</button></div>`;$("retry").onclick=route;logClient(e)}
 finally{v.removeAttribute("aria-busy")}}
async function route0(){
 const pm=location.pathname.match(/^\/(bots|u)\/([^/]+)/),h=(location.hash||"#/feed").split("/");
 document.querySelectorAll("#nav button").forEach(b=>b.classList.toggle("tabon",b.dataset.h===(location.hash||"#/market")||(b.dataset.h==="#/feed"&&/^#\/g(roups)?(\/|$)/.test(location.hash))));
 if(pm&&pm[1]==="u")return profile(decodeURIComponent(pm[2]));
 if(h[1]==="feed")return feed();
 if(h[1]==="g")return feed(decodeURIComponent(h[2]||""));
 if(h[1]==="groups")return groupsView();
 if(h[1]==="admin")return adminView();
 if(h[1]==="creator")return creatorView();
 if(h[1]==="rentals")return window.rentalsView();
 if(h[1]==="u")return profile(h[2]);
 if(h[1]==="me"){if(!prof){$("view").innerHTML='<div class="empty">Sign in to see your profile.</div>';return}return profile(prof.handle)}
 if(h[1]==="market")return market();
 if(!location.hash)history.replaceState(null,"","/#/feed");await feed();if(pm&&pm[1]==="bots"){const sl=decodeURIComponent(pm[2]),b=bots.find(x=>x.slug===sl)||(await sb.from("bot_cards").select("id").eq("slug",sl).maybeSingle()).data;if(b)detail(b.id)}}

let mq={n:24};
function heroProof(b){
 if(!b)return`<div class="proof empty-proof"><div class="proof-kick">Top record today</div><b>The first verified record will appear here</b><p>List a bot and run verification. Tick trades it on live prices for 30 days and publishes the result.</p><div class="proof-foot" style="justify-content:center;border-top:1px solid var(--hair);padding-top:16px"><span class="meta">0 bots verified so far</span></div></div>`;
 const v=b.spark.map(Number),pts=v.map(x=>x/v[0]*100);
 return`<div class="proof"><div class="proof-kick">Top record today</div><div class="proof-head"><div><h3>${esc(b.name)}</h3><div class="sheet-sub">${av(b.creator_name,b.creator_color)}<a class="lnk" href="/u/${esc(b.creator_handle)}">${esc(b.creator_handle)}</a>${ring(b.creator_score)}<span class="b-sep"></span><span>${esc(TYPES[b.strategy])}</span></div></div>${badge("verified")}</div>
 ${areaChart(pts,{h:210,w:520,anim:true,labels:["30 days ago","Today"]})}
 <div class="kp"><div><b class="${b.ret_90d>=0?"pos":"neg"}">${sgn(b.ret_90d)}</b><span>Return, 90 days</span></div><div><b>${num(b.max_dd)}%</b><span>Max drawdown</span></div><div><b>${b.days_live}</b><span>Days of record</span></div></div>
 <div class="proof-foot"><span class="meta">${b.markets.slice(0,2).map(esc).join(", ")} · ${b.trades} trades</span><button class="btn ghost btn-sm" data-open="${b.id}">Full record</button></div></div>`}
async function market(){await marketsReady;
 $("view").innerHTML=`<section class="hero"><div class="hero-copy"><h1>Trading bots<br>with receipts.</h1>
 <p>Every bot here trades on live prices while Tick keeps the books. You see the curve, the drawdown and the reviews before you pay a cent.</p>
 <div class="hero-cta"><button class="btn big" id="browseBtn">Browse bots</button>${me?"":`<button class="btn ghost big" id="listBtn">List your bot</button>`}</div>
</div>
 <div id="heroProof"><div class="skel" style="height:404px;border-radius:24px"></div></div></section>
 <div class="ticker"><div class="ticker-track" id="ticker"></div></div>
 <div class="filterbar" id="list"><label class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input id="fQ" placeholder="Search bots or creators" aria-label="Search bots or creators"></label>
 <label class="fld"><input id="fMarket" list="mlist" placeholder="Any market" aria-label="Market"><datalist id="mlist">${MARKETS.slice(0,500).map(m=>`<option value="${m}">`).join("")}</datalist></label>
 <label class="fld"><select id="fType" aria-label="Strategy"><option value="">All strategies</option>${Object.entries(TYPES).map(([k,v])=>`<option value="${k}">${v}</option>`).join("")}</select></label>
 <label class="toggle"><input type="checkbox" id="fVer"><i></i>Verified only</label>
 <label class="fld"><select id="fSort" aria-label="Sort"><option value="ret">Best return</option><option value="new">Newest</option><option value="rate">Best rated</option><option value="dd">Lowest drawdown</option><option value="price">Lowest price</option><option value="days">Longest record</option></select></label>
 <span class="count" id="fCount" aria-live="polite"></span></div>
 <div class="botlist" role="list"><div id="grid" class="cards">${skeleton()}</div></div><div class="more" id="moreBox"></div>
 ${me?"":`<section class="closing"><div><h2>Your bot belongs on this board.</h2><p>List it, run the 30-day verification, and set your own price. Tick publishes the result, good or bad.</p></div><button class="btn big" data-listbot>List your bot</button></section>`}`;
 sb.from("bot_cards").select("*").eq("verification","verified").not("spark","is",null).order("ret_90d",{ascending:false,nullsFirst:false}).limit(1).then(({data})=>{const el=$("heroProof");if(el){el.innerHTML=heroProof(data&&data[0]);wireCharts(el)}});
 let timer,tkDone=false;
 const f=async more=>{if(!more)mq.n=24;
  const t=$("fQ").value.trim().replace(/[^\w .@-]/g,""),m=$("fMarket").value.trim().toUpperCase(),y=$("fType").value,v=$("fVer").checked?"verified":"",s=$("fSort").value;
  let qy=sb.from("bot_cards").select("*",{count:"exact"});
  if(t)qy=qy.or(`name.ilike.%${t}%,creator_handle.ilike.%${t}%`);
  if(MARKETS.includes(m))qy=qy.contains("markets",[m]);
  if(y)qy=qy.eq("strategy",y);if(v)qy=qy.eq("verification","verified");
  const o={new:["created_at",false],ret:["ret_90d",false],rate:["avg_rating",false],dd:["max_dd",true],price:["price_cents",true],days:["days_live",false]}[s];
  let{data,count,error}=await qy.order(o[0],{ascending:o[1],nullsFirst:false}).range(0,mq.n-1);
  if(error){toast(error.message);return}
  data=await attachBacktests(data||[]);bots=data;$("fCount").textContent=`${count} bot${count===1?"":"s"}`;
  $("grid").innerHTML=data.length?data.map(b=>card(b)).join(""):'<div class="empty"><b>No bots match these filters</b>Clear a filter, or list a bot that fits.</div>';
  $("moreBox").innerHTML=count>data.length?'<button class="btn ghost" id="moreBtn">Show more bots</button>':"";
  const mb=$("moreBtn");if(mb)mb.onclick=()=>{mq.n+=24;f(true)};
  const tk=$("ticker");
  if(tk&&!tkDone&&data.length){
   tkDone=true;
   const seen=new Set();
   const top=[...data].filter(b=>{
    const name=String(b.name||"").trim().toLowerCase();
    const hasStats=b.ret_90d!=null&&b.max_dd!=null&&Number(b.days_live)>0&&Number(b.trades)>0;
    if(!name||seen.has(name)||!hasStats)return false;
    seen.add(name);return true;
   }).sort((a,b)=>Number(b.ret_90d)-Number(a.ret_90d)).slice(0,10);
   const items=top.map(b=>`<span class="tick-item"><b>${esc(b.name)}</b><span class="${Number(b.ret_90d)>=0?"up":"down"}">${sgn(b.ret_90d)}</span><span class="meta">90d</span></span>`).join("");
   tk.innerHTML=items;
  }}
 ["fMarket","fType","fVer","fSort"].forEach(i=>$(i).onchange=()=>f());
 $("fQ").oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>f(),300)};
 await f()}

function money(v){return Number(v||0).toLocaleString("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2})}
function downloadPerformanceCard(d){
 const c=document.createElement("canvas");c.width=1200;c.height=675;const x=c.getContext("2d"),lime="#D8FF3E",ink="#F5F7F8",mute="#8D98A4";
 const bg=x.createLinearGradient(0,0,1200,675);bg.addColorStop(0,"#11151b");bg.addColorStop(1,"#08090c");x.fillStyle=bg;x.fillRect(0,0,1200,675);
 x.strokeStyle="rgba(255,255,255,.055)";x.lineWidth=1;for(let i=0;i<20;i++){x.beginPath();x.moveTo(i*60,0);x.lineTo(i*60,675);x.stroke()}for(let i=0;i<12;i++){x.beginPath();x.moveTo(0,i*60);x.lineTo(1200,i*60);x.stroke()}
 x.fillStyle="rgba(216,255,62,.09)";x.beginPath();x.arc(20,700,520,0,Math.PI*2);x.fill();x.fillStyle=lime;x.fillRect(874,0,2,230);x.shadowColor="rgba(216,255,62,.2)";x.shadowBlur=35;x.fillRect(874,0,2,230);x.shadowBlur=0;
 x.fillStyle="rgba(14,18,23,.94)";x.fillRect(874,40,278,595);x.strokeStyle="rgba(216,255,62,.3)";x.strokeRect(874,40,278,595);
 x.fillStyle=ink;x.font="900 27px Archivo,Arial,sans-serif";x.fillText("TICK/",48,75);x.fillStyle=lime;x.font="700 10px JetBrains Mono,monospace";x.fillText("VERIFIED · 30 DAYS",910,75);
 x.fillStyle=mute;x.font="700 10px JetBrains Mono,monospace";x.fillText("TRADING BOT PERFORMANCE",48,150);x.fillStyle=ink;x.font="800 31px Archivo,Arial,sans-serif";x.fillText(String(d.name).slice(0,25),48,188);
 x.fillStyle=lime;x.font="900 108px Archivo,Arial,sans-serif";x.fillText((d.pnl>=0?"+":"")+money(d.pnl),48,330);x.fillStyle=mute;x.font="700 11px JetBrains Mono,monospace";x.fillText("TOTAL PROFIT / LOSS",50,357);x.fillStyle="#68727d";x.font="500 10px JetBrains Mono,monospace";x.fillText("Verified live-price record · equity curve at right",50,454);
 x.fillStyle=lime;x.font="700 10px JetBrains Mono,monospace";x.fillText("PERFORMANCE SNAPSHOT",900,88);const ms=[["ROI",(d.roi>=0?"+":"")+d.roi.toFixed(2)+"%"],["INITIAL INVESTMENT",money(d.initial)],["CURRENT POSITION VALUE",money(d.current)],["RECORD","Verified"]];ms.forEach((m,i)=>{const yy=145+i*82;x.strokeStyle="rgba(255,255,255,.16)";x.beginPath();x.moveTo(900,yy-22);x.lineTo(1125,yy-22);x.stroke();x.fillStyle=mute;x.font="600 10px JetBrains Mono,monospace";x.fillText(m[0],900,yy);x.fillStyle=i===0||i===3?lime:ink;x.font=`800 ${i===0?42:26}px Archivo,Arial,sans-serif`;x.fillText(m[1],900,yy+31)});
 if(d.points?.length>1){const px=900,py=500,pw=225,ph=75,min=Math.min(...d.points),max=Math.max(...d.points),span=max-min||1;x.strokeStyle="#26302a";x.lineWidth=1;[0,37,74].forEach(v=>{x.beginPath();x.moveTo(px,py+v);x.lineTo(px+pw,py+v);x.stroke()});x.strokeStyle=lime;x.lineWidth=3;x.beginPath();d.points.forEach((v,i)=>{const xx=px+i/(d.points.length-1)*pw,yy=py+ph-(v-min)/span*ph;i?x.lineTo(xx,yy):x.moveTo(xx,yy)});x.stroke()}
 x.fillStyle="#68717d";x.font="500 10px JetBrains Mono,monospace";x.fillText("ticktrading.web.app · Past performance does not predict future returns.",48,642);x.fillStyle="#0b0e12";x.fillRect(970,618,175,28);x.fillStyle=lime;x.font="800 10px JetBrains Mono,monospace";x.fillText("VERIFIED RECORD",983,636);
 const a=document.createElement("a");a.download=`tick-${String(d.name).toLowerCase().replace(/[^a-z0-9]+/g,"-")}-performance.png`;a.href=c.toDataURL("image/png");a.click();
}
async function verifiedPerformance(botId,name){
 const {data:stats}=await sb.from("bot_stats").select("ret_90d").eq("bot_id",botId).maybeSingle();
 const {data:runs}=await sb.from("verification_runs").select("id").eq("bot_id",botId).eq("state","verified").order("created_at",{ascending:false}).limit(1);
 const run=runs?.[0];if(!run)return null;
 const points=await q(sb.from("equity_snapshots").select("equity,ts").eq("run_id",run.id).order("ts"));
 if(!points?.length)return null;const values=points.map(x=>Number(x.equity)).filter(Number.isFinite);if(!values.length||values[0]<=0)return null;
 const initial=values[0],current=values.at(-1),roi=(current-initial)/initial*100;
 return {name,initial,current,pnl:current-initial,roi,points:values,sourceROI:stats?.ret_90d};
}
async function detail(id){
 let b=bots.find(x=>x.id===id)||await q(sb.from("bot_cards").select("*").eq("id",id).single());b=(await attachBacktests([b]))[0];
 const rv=await q(sb.from("reviews").select("*,profiles(handle)").eq("bot_id",id).order("created_at",{ascending:false}));
 let rent=null;if(me){const{data}=await sb.from("rentals").select("*").eq("bot_id",id).eq("renter_id",me.id).maybeSingle();rent=data}
 const mine=me&&b.creator_id===me.id,on=rent&&rent.status==="active";
 const ver=mine?await q(sb.from("bot_versions").select("version,check_state,check_report").eq("bot_id",id).order("version",{ascending:false}).limit(1)):[],cs=ver[0]?.check_state;
 const cfg=Object.fromEntries((await q(sb.from("app_config").select("*"))).map(r=>[r.key,r.value]));
 const conns=me&&rent?await q(sb.from("exchange_connections").select("id,label,key_hint")):[];
 const perf=me&&b.creator_id===me.id&&b.verification==="verified"?await verifiedPerformance(id,b.name):null;
 const live=!rent||mine?"":cfg.live_execution_enabled!=="true"?'<div class="post" style="margin:0"><b>Live trading</b><div class="note">Not enabled on Tick yet. Rentals run in paper mode.</div></div>':b.verification!=="verified"?'<div class="post" style="margin:0"><b>Live trading</b><div class="note">Only verified bots can trade live.</div></div>':prof?.kyc_status!=="verified"?'<div class="post" style="margin:0"><b>Live trading</b><div class="note">Verify your identity first: open Settings and choose Verify identity.</div></div>':rent.live?`<div class="post" style="margin:0"><b>Live trading is on</b><div class="note">Allocation $${rent.allocation_usd}. Daily loss limit ${rent.max_daily_loss_pct}%. The bot only trades the cash you allocated, never your other holdings. Updates hourly.</div><button class="btn ghost" id="lvStop" style="margin-top:8px">Stop and sell positions</button></div>`:`<div class="post" style="margin:0"><b>Live trading</b>${rent.paused_reason?`<div class="note neg">Stopped: ${esc(rent.paused_reason)}</div>`:""}
  <div class="note">Live trading runs on your own Alpaca account. You approve Tick on Alpaca's site, so Tick never sees your password, and you can revoke access there at any time. Limit: $${cfg.max_live_allocation_usd} per rental during the beta. You can lose money.</div>
  ${conns.length?`<label class="note" style="display:block;margin-top:8px">Key<select id="lvKey">${conns.map(c=>`<option value="${c.id}">${esc(c.label)} (…${esc(c.key_hint)})</option>`).join("")}</select></label>`:""}
  <button class="btn ghost" id="alpConnect" style="margin-top:8px">Connect Alpaca account</button>
  <div class="two" style="margin-top:8px"><label class="note">Allocation (USD)<input id="lvAlloc" type="number" min="10" max="${esc(cfg.max_live_allocation_usd)}" value="10"></label><label class="note">Daily loss limit (%)<input id="lvLoss" type="number" min="1" max="50" value="5"></label><label class="note">Max drawdown (%)<input id="lvDD" type="number" min="5" max="80" value="20"></label><label class="note">Stop-loss per position (%, optional)<input id="lvSL" type="number" min="1" max="50" placeholder="none"></label></div>
  <button class="btn" id="lvStart" style="margin-top:8px">Start live trading</button></div>`;
 $("detailBody").innerHTML=`<div class="sheet-top"><div><div class="kick">${esc(b.markets.slice(0,2).join(" · "))||"Bot"}${b.days_live?` · ${b.days_live} days of record`:""}</div><h2 tabindex="-1" id="dTitle">${esc(b.name)}</h2><div class="sheet-sub">${av(b.creator_name,b.creator_color)}<a class="lnk" href="/u/${esc(b.creator_handle)}">@${esc(b.creator_handle)}</a>${ring(b.creator_score)}<span class="b-sep"></span><span>${esc(TYPES[b.strategy])}</span><span class="b-sep"></span>${stars(b)}</div></div>
 <div class="row" style="flex-wrap:nowrap;gap:8px">${codeChip(b)}${badge(b.verification)}<button class="icon" id="dClose" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>
 <div class="sheet-grid"><div class="sheet-main">
 <section><div class="chart-context"><div><h3>Equity curve</h3><p>Indexed bot portfolio value. This is the bot's account performance, not the price chart of an individual asset.</p></div><span>${rent&&!mine?"Live rental record":b.stats_source==="live"?"Live trading record":"Paper record · start = 100"}</span></div><div id="eqChart"><div class="skel" style="height:280px"></div></div>${kpis(b)}${perf?`<div class="performance-share"><div><b>Share this verified record</b><span>Generate a premium PNG with the real verified equity figures.</span></div><button class="btn" id="perfCardBtn">Download performance card</button></div>`:""}</section>
 ${b.code_check==="warned"&&(b.code_check_notes||[]).length?`<section class="post"><h3 style="margin-bottom:8px">Code check notes</h3><p class="note" style="margin-bottom:10px">The code passed Tick's checks, with these observations:</p><div class="chips">${b.code_check_notes.map(x=>`<span class="chip">${esc(x)}</span>`).join("")}</div></section>`:""}
 <section><h3>About this bot</h3><p style="max-width:66ch;color:var(--ink2);font-size:15px;line-height:1.65">${esc(b.description)||"The creator has not added a description yet."}</p><div class="chips" style="margin-top:16px">${b.markets.map(x=>`<span class="chip">${esc(x)}</span>`).join("")}</div></section>
 ${rent&&!mine?`<section><h3>Leave a review</h3><div class="review-compose"><div class="star-picker" id="rStars" role="radiogroup" aria-label="Rating"><button type="button" data-star="1" aria-label="1 star">★</button><button type="button" data-star="2" aria-label="2 stars">★</button><button type="button" data-star="3" aria-label="3 stars">★</button><button type="button" data-star="4" aria-label="4 stars">★</button><button type="button" data-star="5" aria-label="5 stars">★</button></div><input id="rText" maxlength="400" placeholder="How did it perform?" aria-label="Your review"></div><button class="btn" id="rGo" style="margin-top:14px">Post review</button></section>`:""}
 ${live?`<section><h3>Live trading</h3>${live}</section>`:""}
 <section id="trades"></section>
 <section><h3>Reviews${rv.length?` <span style="color:var(--mute);letter-spacing:0">· ${rv.length}</span>`:""}</h3>${rv.length?`<div class="rv-list">${rv.map(r=>`<div class="review"><div class="who-line">${av(r.profiles?.handle,"#3E4E5A")}<span class="handle">@${esc(r.profiles?.handle)}</span><span class="stars" aria-label="${r.rating} out of 5">${"★".repeat(r.rating)}</span></div><p>${esc(r.body)}</p>${r.reply?`<div class="reply"><b>Creator reply</b> ${esc(r.reply)}</div>`:""}${mine&&!r.reply?`<button class="lnk" data-reply="${r.id}" style="margin-top:10px;font-size:13px">Reply</button>`:""}${me&&r.reviewer_id===me.id?`<span class="review-owner-actions"><button class="lnk" data-editrv="${r.id}" style="margin-top:10px;font-size:13px">Edit</button><button class="lnk danger-link" data-delrv="${r.id}" style="margin-top:10px;font-size:13px">Delete</button></span>`:""}</div>`).join("")}</div>`:`<p class="note">No reviews yet. Renters can review after trying the bot.</p>`}</section>
 ${mine?`<section><h3>Verification</h3><div class="post">${checkPanel(ver[0])}<p class="note" style="margin-bottom:14px">${b.verification==="none"||b.verification==="failed"?"Every listed bot gets a free paper run on live market data, labelled Paper. Verification continues that same run for up to 30 days and awards the seal only if it passes. The fee covers the test and is paid once per bot: later versions are re-verified at no cost. It is not a guarantee.":b.verification==="verified"?"Verified. Uploading new code resets this.":"Run in progress. Stats update hourly."}</p>
 ${b.verification==="none"||b.verification==="failed"?`<button class="btn" id="dVerify" style="margin-bottom:14px"${b.current_version_id&&(cs==="passed"||cs==="warned"||b.code_check==="passed"||b.code_check==="warned")?"":" disabled"}>${cs==="pending"||cs==="running"?"Code checks running…":cs==="failed"?"Fix the code checks first":"Start verification"}</button>`:""}
 <label class="note" style="display:block">Upload new code (.py)<input id="dFile" type="file" accept=".py"></label></div></section>`:""}
 </div>
 <aside class="buy"><div class="buy-kick">${b.price_cents?"Rental price":"Paper mode"}</div><div class="price">${b.price_cents?`$${(b.price_cents/100).toFixed(b.price_cents%100?2:0)} <small>per ${b.billing_period}</small>`:"Free"}</div>
 ${mine?`<p class="note" style="margin-top:14px">This is your bot. Change its price and description under My bots.</p>`:`<button class="btn big block" id="dRent" style="margin-top:18px">${on?"Cancel rental":b.price_cents?"Rent this bot":"Try this bot free"}</button>
 <ul><li>Starts in paper mode, with no money at risk</li><li>Live trading is optional and uses your own exchange key</li><li>${b.price_cents?"Billed through Stripe. Cancel any time":"Cancel any time"}</li></ul>
 <p class="note">Past results do not predict future returns. Use exchange keys with trading on and withdrawals off.</p>
 <button class="lnk" id="dReport" style="margin-top:14px">Report this bot</button>`}
 </aside></div>`;
 $("detail").showModal();$("dTitle").focus({preventScroll:true});$("dClose").onclick=()=>$("detail").close();const pcb=$("perfCardBtn");if(pcb)pcb.onclick=()=>downloadPerformanceCard(perf);loadCharts(id,rent?.id);
 const rb=$("dRent");if(rb)rb.onclick=async()=>{if(!me){$("detail").close();$("auth").showModal();return}
  if(on&&rent.stripe_subscription_id){await fn("cancel-rental",{rental_id:rent.id});toast("Ends at the end of the billing period");$("detail").close();return}
  if(!on&&cfg.payments_enabled==="true"&&b.price_cents>0){const r=await fn("rental-checkout",{bot_id:id});location.href=r.checkout_url;return}
  if(rent)await q(sb.from("rentals").update({status:on?"cancelled":"active"}).eq("id",rent.id));else await q(sb.from("rentals").insert({bot_id:id,renter_id:me.id}));
  toast(on?"Rental cancelled":"Rented "+b.name);$("detail").close()};
 const ac=$("alpConnect");if(ac)ac.onclick=async()=>{const r=await fn("alpaca-connect",{});location.href=r.url};
 const ls=$("lvStart");if(ls)ls.onclick=async()=>{const kid=$("lvKey")?.value;if(!kid){toast("Connect your Alpaca account first");return}
  if(!confirm("Tick's worker will place real market orders on your Alpaca account with the amount you allocated. You can lose some or all of it. Continue?"))return;
  await q(sb.from("rentals").update({connection_id:kid,allocation_usd:+$("lvAlloc").value,max_daily_loss_pct:+$("lvLoss").value,max_drawdown_pct:+$("lvDD").value,stop_loss_pct:$("lvSL").value?+$("lvSL").value:null,live:true,paused_reason:null}).eq("id",rent.id));toast("Live trading started");$("detail").close();route()};
 const lx=$("lvStop");if(lx)lx.onclick=async()=>{await q(sb.from("rentals").update({live:false}).eq("id",rent.id));toast("Stopping. Positions are sold within 10 minutes");$("detail").close()};
 const vb=$("dVerify");if(vb)vb.onclick=async()=>{vb.disabled=true;const original=vb.textContent;vb.textContent="Starting…";try{const r=await fn("start-verification",{bot_id:id});if(r?.checkout_url)location.href=r.checkout_url;else if(r?.url)location.href=r.url;else{toast("Verification started");$("detail").close();route()}}catch(e){vb.disabled=false;vb.textContent=original;toast(e?.message||"Could not start verification")}};
 const df=$("dFile");if(df)df.onchange=async()=>{const fl=df.files[0];if(!fl)return;if(fl.size>200000){toast("Code file is over 200 KB");return}
  const path=`${me.id}/${id}/${Date.now()}.py`;await q(sb.storage.from("bot-code").upload(path,fl));const r=await fn("register-version",{bot_id:id,path});toast("Uploaded version "+r.version);$("detail").close();route()};
 const rp=$("dReport");if(rp)rp.onclick=()=>report("bot",id);
 document.querySelectorAll("#detailBody [data-reply]").forEach(e=>e.onclick=async()=>{const t=prompt("Your reply (max 400 characters)");if(!t)return;await q(sb.from("reviews").update({reply:t.slice(0,400)}).eq("id",e.dataset.reply));$("detail").close();detail(id)});
 document.querySelectorAll("#detailBody [data-editrv]").forEach(e=>e.onclick=async()=>{const review=rv.find(x=>x.id===e.dataset.editrv),t=prompt("Edit your review",review?.body||"");if(t===null)return;const body=t.trim().slice(0,400);if(!body){toast("Your review cannot be empty");return}await q(sb.from("reviews").update({body}).eq("id",e.dataset.editrv).eq("reviewer_id",me.id));toast("Review updated");$("detail").close();detail(id)});
 document.querySelectorAll("#detailBody [data-delrv]").forEach(e=>e.onclick=async()=>{if(!confirm("Delete your review? This cannot be undone."))return;await q(sb.from("reviews").delete().eq("id",e.dataset.delrv).eq("reviewer_id",me.id));toast("Review deleted");$("detail").close();detail(id)});
 const starsBox=$("rStars");let selectedRating=0;
 if(starsBox)starsBox.onclick=e=>{const star=e.target.closest("[data-star]");if(!star)return;selectedRating=Number(star.dataset.star);starsBox.querySelectorAll("[data-star]").forEach(x=>{const on=Number(x.dataset.star)<=selectedRating;x.classList.toggle("on",on);x.setAttribute("aria-checked",on&&Number(x.dataset.star)===selectedRating?"true":"false")})};
 const gb=$("rGo");if(gb)gb.onclick=async()=>{const t=$("rText").value.trim();if(!selectedRating){toast("Choose a star rating first");return}if(!t){toast("Write a short review first");return}
  await q(sb.from("reviews").insert({bot_id:id,rental_id:rent.id,reviewer_id:me.id,rating:selectedRating,body:t}));toast("Review posted");$("detail").close();route()}}

const go=h=>{history.pushState(null,"","/"+h);route()};
const NIL="00000000-0000-0000-0000-000000000000";
const slugify=n=>n.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,30);
const gchip=p=>p.group_slug?`<button class="chip" data-go="#/g/${esc(p.group_slug)}" style="border:0;cursor:pointer">${esc(p.group_name)}</button>`:"";
const postMedia=p=>p.media_url?(p.media_type==="video"?`<div class="post-media"><video controls preload="metadata" src="${esc(p.media_url)}"></video></div>`:`<div class="post-media"><img loading="lazy" src="${esc(p.media_url)}" alt="Media attached to post"></div>`):"";
const postActions=(p)=>`<div class="pactions x-actions" aria-label="Post actions"><button class="pact" data-cm="${p.id}" aria-label="Comment"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.2a7.3 7.3 0 0 1-7.3 7.3H8l-4 2.5v-5.1a7.2 7.2 0 0 1-1.1-3.8A7.3 7.3 0 0 1 10.2 5h2.5A7.3 7.3 0 0 1 20 11.2Z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01"/></svg><span>${p.comments||0}</span></button><button class="pact" data-repost="${p.id}" aria-label="Repost"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg><span>${p.reposts||0}</span></button><button class="pact ${p._liked?"on":""}" data-like="${p.id}" aria-label="Like"><svg viewBox="0 0 24 24" aria-hidden="true" class="fillable"><path d="M20.8 8.9c0 5.2-8.8 10.1-8.8 10.1S3.2 14.1 3.2 8.9A4.4 4.4 0 0 1 12 7a4.4 4.4 0 0 1 8.8 1.9Z"/></svg><span>${p.likes||0}</span></button><span class="pact impressions" aria-label="Impressions"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20V11"/><path d="M8 20V5"/><path d="M13 20v-8"/><path d="M18 20V3"/><path d="M22 20H2"/></svg><span>${p.impressions||0}</span></span><span class="x-action-tail"><button class="pact ${p._bookmarked?"on":""}" data-bookmark="${p.id}" aria-label="Bookmark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.5A2.5 2.5 0 0 1 9 2h6a2.5 2.5 0 0 1 2.5 2.5V21L12 17.7 6.5 21V4.5Z"/></svg><span>${p.bookmarks||0}</span></button><button class="pact ${p._shared?"on":""}" data-share="${p.id}" aria-label="Share"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg><span>${p.shares||0}</span></button></span></div>`;
const postMenu=(p,owner)=>owner?`<details class="post-menu"><summary aria-label="More post options">•••</summary><div class="post-menu-pop"><button data-del="${p.id}">Delete</button></div></details>`:"";
async function loadGroupData(){const key=me?.id||"anon";if(groupCache&&groupCacheUser===key&&Date.now()-groupCacheAt<15000)return groupCache;const [groups,mem]=await Promise.all([q(sb.from("group_cards").select("*").order("members",{ascending:false}).order("name")),myGroups()]);groupCache={groups,mem};groupCacheUser=key;groupCacheAt=Date.now();return groupCache}
async function myGroups(){return me?await q(sb.from("group_members").select("group_id,role").eq("user_id",me.id)):[]}
async function joinLeave(g,mine){
 if(!me){$("auth").showModal();return}
 if(mine.has(g.id)){if(mine.get(g.id)==="mod"&&!confirm("You moderate this group. Leave anyway?"))return;await q(sb.from("group_members").delete().eq("group_id",g.id).eq("user_id",me.id))}
 else await q(sb.from("group_members").insert({group_id:g.id,user_id:me.id}));groupCache=null}

function actionState(btn,delta,on){if(!btn)return;const n=btn.querySelector("span:last-child");if(n)n.textContent=Math.max(0,(parseInt(n.textContent,10)||0)+delta);if(on!==undefined)btn.classList.toggle("on",on);btn.classList.add("action-pulse");setTimeout(()=>btn.classList.remove("action-pulse"),220)}
async function toggleRepost(id,refresh,btn){if(!me){$("auth").showModal();return}const was=!!btn?.classList.contains("on");actionState(btn,was?-1:1,!was);try{const own=(await safeRows(sb.from("post_reposts").select("post_id").eq("post_id",id).eq("user_id",me.id))).length>0;const r=own===was?(was?await sb.from("post_reposts").delete().eq("post_id",id).eq("user_id",me.id):await sb.from("post_reposts").insert({post_id:id,user_id:me.id})):null;if(r?.error)throw r.error}catch(e){actionState(btn,was?1:-1,was);toast(e.message||"Could not update repost")}}
async function recordImpressions(posts){if(!me||!posts?.length)return;const rows=posts.map(p=>({post_id:p.id,user_id:me.id}));await sb.from("post_impressions").upsert(rows,{onConflict:"post_id,user_id",ignoreDuplicates:true})}
async function toggleBookmark(id,refresh,btn){if(!me){$("auth").showModal();return}const was=!!btn?.classList.contains("on");actionState(btn,was?-1:1,!was);try{const own=(await safeRows(sb.from("post_bookmarks").select("post_id").eq("post_id",id).eq("user_id",me.id))).length>0;const r=own?await sb.from("post_bookmarks").delete().eq("post_id",id).eq("user_id",me.id):await sb.from("post_bookmarks").insert({post_id:id,user_id:me.id});if(r.error)throw r.error}catch(e){actionState(btn,was?1:-1,was);toast(e.message||"Could not update bookmark")}}
async function recordShare(id,refresh,btn){if(!me){$("auth").showModal();return}actionState(btn,1,true);try{const r=await sb.from("post_shares").upsert({post_id:id,user_id:me.id},{onConflict:"post_id,user_id",ignoreDuplicates:true});if(r.error)throw r.error;try{await navigator.clipboard.writeText(location.href);toast("Link copied")}catch{toast("Copy the page link to share")}}catch(e){toast(e.message||"Could not record share")}}
async function toggleLike(id,btn){if(!me){$("auth").showModal();return}const was=!!btn?.classList.contains("on");actionState(btn,was?-1:1,!was);try{const r=was?await sb.from("post_likes").delete().eq("post_id",id).eq("user_id",me.id):await sb.from("post_likes").insert({post_id:id,user_id:me.id});if(r.error)throw r.error}catch(e){actionState(btn,was?1:-1,was);toast(e.message||"Could not update like")}}
async function feed(slug){
 const{groups,mem}=await loadGroupData();
 const mine=new Map(mem.map(m=>[m.group_id,m.role])),G=slug?groups.find(g=>g.slug===slug):null;
 if(slug&&!G){$("view").innerHTML='<div class="empty"><b>Group not found</b>It may have been removed. <button class="btn ghost" data-go="#/groups" style="margin-left:8px">Browse groups</button></div>';document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));return}
 let fq=sb.from("post_feed").select("*").order("created_at",{ascending:false}).limit(feedLimit);
 if(G)fq=fq.eq("group_id",G.id);
 else if(feedScope==="following"&&me){const f=await q(sb.from("follows").select("followee_id").eq("follower_id",me.id));fq=fq.in("author_id",f.map(x=>x.followee_id).concat([me.id]))}
 else if(feedScope==="groups"&&me){const ids=[...mine.keys()];fq=fq.in("group_id",ids.length?ids:[NIL])}
 const[ps,top]=await Promise.all([q(fq),G?[]:q(sb.from("profiles").select("handle,display_name,color,relay_score").not("relay_score","is",null).order("relay_score",{ascending:false}).limit(5))]);
 let liked=[],bookmarked=[];if(me){const [likes,marks]=await Promise.all([safeRows(sb.from("post_likes").select("post_id").eq("user_id",me.id)),safeRows(sb.from("post_bookmarks").select("post_id").eq("user_id",me.id))]);liked=likes.map(x=>x.post_id);bookmarked=marks.map(x=>x.post_id)}
 const isMod=g=>g&&(mine.get(g)==="mod"||isStaff()),joined=g=>g&&mine.has(g);
 const opts=groups.filter(g=>mine.has(g.id)),dflt=G&&joined(G.id)?G.id:"";
 const head=G?`<div class="phead"><div><button class="lnk" data-go="#/feed" style="color:var(--mute)">Feed</button><h1>${esc(G.name)}${G.official?` <span class="seal">${SEAL}Official</span>`:""}</h1><p>${esc(G.description)||"No description yet."}</p><div class="note" style="margin-top:6px">${G.members} member${G.members==1?"":"s"}, ${G.posts_7d} post${G.posts_7d==1?"":"s"} this week</div></div><div><button class="btn ${joined(G.id)?"ghost":""}" id="gJoin">${joined(G.id)?(mine.get(G.id)==="mod"?"Moderator: leave":"Leave group"):"Join group"}</button></div></div>`
  :`<div class="phead"><div><h1>Feed</h1><p>Updates from creators and renters. Be specific and be kind.</p></div><div class="seg" role="group" aria-label="Feed views"><button class="${feedScope==="groups"?"on":""}" data-fs="groups">My groups</button><button class="${feedScope==="following"?"on":""}" data-fs="following">Following</button></div></div>`;
 const compose=!me?'<div class="post"><b>Join the conversation.</b> <button class="lnk" id="feedSign">Sign in</button> to post, like and comment.</div>'
  :G&&!joined(G.id)?'<div class="post"><b>Join this group to post.</b> You can still read and like posts.</div>'
  :`<div class="post compose"><textarea id="pText" rows="2" maxlength="280" placeholder="${G?"Post to "+esc(G.name):"Share what you are building or watching"}" aria-label="New post"></textarea><div id="postMediaPreview" class="post-media-preview" hidden></div><div class="compose-meta"><span class="media-trigger"><label class="media-upload" for="postFile" title="Attach a photo, GIF or video"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20.5 11.5-7.8 7.8a5 5 0 0 1-7.1-7.1l8.1-8.1a3.5 3.5 0 0 1 5 5l-8.1 8.1a2 2 0 0 1-2.8-2.8l7.3-7.3"/></svg></label><span class="media-max">25MB max</span></span><input id="postFile" type="file" accept="image/*,video/*" hidden><span class="compose-actions"><span class="char-counter" id="postCounter" aria-label="280 characters remaining"><svg viewBox="0 0 40 40" aria-hidden="true"><circle class="char-track" cx="20" cy="20" r="17"></circle><circle class="char-progress" cx="20" cy="20" r="17"></circle></svg><b>280</b></span><button class="btn" id="pGo">Post</button></span></div></div>`;
 const card=p=>`<article class="post fpost"><div class="post-head"><div class="who">${av(p.display_name,p.color,p.avatar_url)}<div class="who-txt"><div class="who-top"><a class="lnk handle" data-profile-handle="${esc(p.handle)}" href="/u/${esc(p.handle)}">${esc(p.display_name||p.handle)}</a><span class="post-handle">@${esc(p.handle)} · ${ago(p.created_at)}</span>${p.system?`<span class="seal">${SEAL}Tick</span>`:""}${G?"":gchip(p)}</div></div></div></div><p class="body">${esc(p.body)}</p>${postMedia(p)}${postActions({...p,_liked:liked.includes(p.id),_bookmarked:bookmarked.includes(p.id)})}<div id="cm-${p.id}"></div></article>`;
 const side=G?`<aside class="sidebox"><h3>About this group</h3><p class="note">${esc(G.description)||"No description yet."}</p><p class="note" style="margin-top:10px">${G.official?"Run by the Tick team.":"Created by a member."} Be kind, stay on topic, and report anything that breaks the rules. Moderators can remove posts and ban members.</p>${isMod(G.id)&&!G.official?`<details style="margin-top:12px"><summary class="note" style="cursor:pointer">Edit group</summary><label class="note" style="display:block;margin-top:8px">Description<textarea id="gDesc" rows="3" maxlength="280">${esc(G.description)}</textarea></label><button class="btn ghost" id="gSave" style="margin-top:6px">Save</button></details>`:""}<div style="margin-top:14px"><button class="lnk" data-go="#/groups">Browse all groups</button></div></aside>`
  :`<aside class="sidebox"><h3>Groups</h3>${groups.slice(0,8).map(g=>`<div class="lead"><div style="flex:1;min-width:0"><button class="lnk" data-go="#/g/${esc(g.slug)}" style="color:var(--ink);text-align:left">${esc(g.name)}</button><div class="note">${g.members} member${g.members==1?"":"s"}</div></div>${joined(g.id)?'<span class="note">Joined</span>':`<button class="btn ghost" data-join="${g.id}" style="padding:4px 12px">Join</button>`}</div>`).join("")}<div style="margin:10px 0 22px"><button class="lnk" data-go="#/groups">Browse all groups or start one</button></div>
  <h3>Top creators</h3>${top.map(t=>`<div class="lead">${av(t.display_name,t.color)}<div style="flex:1;min-width:0"><a class="lnk" href="/u/${esc(t.handle)}" style="color:var(--ink)">${esc(t.display_name)}</a><div class="note">@${esc(t.handle)}</div></div>${ring(t.relay_score)}</div>`).join("")||'<div class="note">Scores appear once creators have verified, rated bots.</div>'}<p class="note" style="margin-top:14px">Tick score blends renter ratings, verified bots and live record.</p></aside>`;
 $("view").innerHTML=`${head}<div class="feedwrap"><div>${compose}
 ${ps.length?ps.map(card).join(""):`<div class="empty"><b>Nothing here yet</b>${G?"Be the first to post in this group.":feedScope==="groups"?"Join a few groups to fill this feed.":feedScope==="following"?"Follow people to see their posts here.":"Post an update to start the conversation."}</div>`}
 ${ps.length>=feedLimit?'<div class="more"><button class="btn ghost" id="moreFeed">Show more posts</button></div>':""}</div>${side}</div>`;
 void recordImpressions(ps);
 document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>go(b.dataset.go));
 document.querySelectorAll("[data-cm]").forEach(b=>b.onclick=()=>comments(b.dataset.cm,b));
 document.querySelectorAll("[data-repost]").forEach(b=>b.onclick=()=>toggleRepost(b.dataset.repost,null,b));
 document.querySelectorAll("[data-bookmark]").forEach(b=>b.onclick=()=>toggleBookmark(b.dataset.bookmark,null,b));
 document.querySelectorAll("[data-share]").forEach(b=>b.onclick=()=>recordShare(b.dataset.share,null,b));
 document.querySelectorAll("[data-fs]").forEach(b=>b.onclick=()=>{feedScope=b.dataset.fs;feedLimit=20;feed()});
 document.querySelectorAll("[data-join]").forEach(b=>b.onclick=async()=>{await joinLeave({id:b.dataset.join},mine);feed(slug)});
 const gj=$("gJoin");if(gj)gj.onclick=async()=>{await joinLeave(G,mine);feed(slug)};
 const gs=$("gSave");if(gs)gs.onclick=async()=>{await q(sb.from("groups").update({description:$("gDesc").value.trim()}).eq("id",G.id));toast("Group updated");feed(slug)};
 const mf=$("moreFeed");if(mf)mf.onclick=()=>{feedLimit+=20;feed(slug)};
 const fsg=$("feedSign");if(fsg)fsg.onclick=()=>$("auth").showModal();
 document.querySelectorAll("[data-report]").forEach(e=>e.onclick=()=>me?report("post",e.dataset.report):$("auth").showModal());
 document.querySelectorAll("[data-del]").forEach(e=>e.onclick=async()=>{if(!confirm("Delete this post?"))return;await q(sb.from("posts").delete().eq("id",e.dataset.del));feed(slug)});
 document.querySelectorAll("[data-rm]").forEach(e=>e.onclick=async()=>{if(!confirm("Remove this post from the group?"))return;await q(sb.from("posts").delete().eq("id",e.dataset.rm));feed(slug)});
 document.querySelectorAll("[data-ban]").forEach(e=>e.onclick=async()=>{if(!confirm("Ban this person from the group? They are removed and cannot rejoin."))return;const[g,u]=e.dataset.ban.split("|");await q(sb.from("group_bans").insert({group_id:g,user_id:u}));toast("Banned from the group");feed(slug)});
 const postInput=$("pText"),postCounter=$("postCounter");if(postInput&&postCounter){const updateCount=()=>{const used=postInput.value.length,left=280-used,progress=postCounter.querySelector(".char-progress");postCounter.querySelector("b").textContent=left;postCounter.setAttribute("aria-label",left+" characters remaining");if(progress){progress.style.strokeDashoffset=String(107-(Math.min(280,used)/280)*107);progress.classList.toggle("near-limit",left<40)}};postInput.oninput=updateCount;updateCount()}
 const mediaInput=$("postFile"),mediaPreview=$("postMediaPreview");if(mediaInput&&mediaPreview)mediaInput.onchange=()=>{const f=mediaInput.files?.[0];if(!f)return;const u=URL.createObjectURL(f);mediaPreview.hidden=false;mediaPreview.innerHTML=f.type.startsWith("video/")?`<video controls muted src="${u}"></video>`:`<img src="${u}" alt="Selected media preview"><button type="button" class="media-remove" aria-label="Remove media">×</button>`;const rm=mediaPreview.querySelector(".media-remove");if(rm)rm.onclick=()=>{mediaInput.value="";mediaPreview.hidden=true;mediaPreview.innerHTML="";URL.revokeObjectURL(u)}};
 const g=$("pGo");if(g)g.onclick=async()=>{const t=$("pText").value.trim(),file=mediaInput?.files?.[0];if(!t&&!file){toast("Write something or attach media first");return}if(file&&(!/^image\//.test(file.type)&&!/^video\//.test(file.type)||file.size>25*1024*1024)){toast("Choose an image, GIF or video under 25 MB");return}g.disabled=true;try{let media_url=null,media_type=null;if(file){const ext=(file.name.split(".").pop()||"bin").toLowerCase(),path=`${me.id}/${crypto.randomUUID()}.${ext}`,up=await sb.storage.from("post-media").upload(path,file,{contentType:file.type,upsert:false});if(up.error)throw up.error;media_url=sb.storage.from("post-media").getPublicUrl(path).data.publicUrl;media_type=file.type.startsWith("video/")?"video":"image"}const gid=G?G.id:null;await q(sb.from("posts").insert({author_id:me.id,body:t||" ",group_id:gid,media_url,media_type}));feed(slug)}catch(e){toast(e.message||"Could not publish this post")}finally{g.disabled=false}};
 document.querySelectorAll("[data-like]").forEach(e=>e.onclick=()=>toggleLike(e.dataset.like,e))}

async function groupsView(){
 const{groups,mem}=await loadGroupData();
 const mine=new Map(mem.map(m=>[m.group_id,m.role]));
 const joinedCount=mem.length,totalPosts=groups.reduce((n,g)=>n+Number(g.posts_7d||0),0);
 $("view").innerHTML=`<section class="groups-hero"><div><span class="eyebrow">THE TICK NETWORK</span><h1>Groups</h1><p>Find your trading people, compare ideas and build a feed around the markets you actually follow.</p></div><div class="groups-stats"><div><b>${groups.length}</b><span>Communities</span></div><div><b>${joinedCount}</b><span>Joined</span></div><div><b>${totalPosts}</b><span>Posts this week</span></div></div></section>
 <div class="groups-toolbar"><label class="group-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16 16 4 4"></path></svg><input id="gFind" type="search" placeholder="Search groups by name or topic" aria-label="Search groups"></label>${me?'<button class="btn" id="ngGoTop">Create a group</button>':'<button class="btn" id="gSignTop">Sign in to create</button>'}</div>
 <div class="group-layout"><div><div id="gList" class="group-card-grid"></div></div><aside class="group-create-panel" id="groupCreatePanel"><div class="eyebrow">START SOMETHING</div><h2>Create a group</h2><p>${me?'Bring together traders around a strategy, market or shared edge.':'Sign in to create a group and start building your own trading community.'}</p>${me?`<label class="note">Name<input id="ngName" maxlength="40" placeholder="e.g. Altcoin grid traders"></label><label class="note" style="display:block;margin-top:12px">What is it about?<textarea id="ngDesc" rows="4" maxlength="280" placeholder="What should people expect here?"></textarea></label><button class="btn block" id="ngGo" style="margin-top:12px">Create group</button><p class="note" style="margin-top:10px">You become its moderator. Up to 3 new groups per hour.</p>`:'<button class="btn ghost block" id="gSign">Sign in</button>'}</aside></div>`;
 const draw=()=>{const t=($('gFind').value||'').toLowerCase().trim(),l=groups.filter(g=>!t||g.name.toLowerCase().includes(t)||g.description.toLowerCase().includes(t));
  $('gList').innerHTML=l.map(g=>`<article class="group-card"><div class="group-card-top"><div class="g-mark">#</div><div class="group-card-title"><button class="lnk" data-go="#/g/${esc(g.slug)}">${esc(g.name)}</button>${g.official?`<span class="seal">${SEAL}Official</span>`:''}</div></div><p>${esc(g.description)||'A focused place to talk markets and trading.'}</p><div class="group-card-foot"><span>${g.members} member${g.members==1?'':'s'}</span><span>${g.posts_7d} post${g.posts_7d==1?'':'s'} this week</span>${mine.has(g.id)?`<button class="btn ghost btn-sm" data-leave="${g.id}">Leave</button>`:`<button class="btn btn-sm" data-join="${g.id}">Join</button>`}</div></article>`).join('')||'<div class="empty"><b>No groups match</b>Try another search or create a new group.</div>';
  document.querySelectorAll('#gList [data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
  document.querySelectorAll('#gList [data-join]').forEach(b=>b.onclick=async()=>{await joinLeave({id:b.dataset.join},mine);groupsView()});
  document.querySelectorAll('#gList [data-leave]').forEach(b=>b.onclick=async()=>{await joinLeave({id:b.dataset.leave},mine);groupsView()});
 };
 draw();$('gFind').oninput=draw;
 const gs=$('gSign'),gst=$('gSignTop');[gs,gst].forEach(b=>{if(b)b.onclick=()=>$('auth').showModal()});
 const top=$('ngGoTop');if(top)top.onclick=()=>$('groupCreatePanel').scrollIntoView({behavior:'smooth',block:'center'});
 const ng=$('ngGo');if(ng)ng.onclick=async()=>{const name=$('ngName').value.trim(),slug=slugify(name);if(name.length<3||slug.length<3){toast('Give the group a name of at least 3 letters');return}await q(sb.from('groups').insert({slug,name,description:$('ngDesc').value.trim(),created_by:me.id}));toast('Group created');go('#/g/'+slug)};
}
async function profile(handle){
 const seq=window.__navSeq;
 const p=await q(sb.from("profiles").select("*").eq("handle",handle).maybeSingle());
 if(seq!==window.__navSeq)return;
 if(!p){$("view").innerHTML='<div class="empty"><b>Profile not found</b>Check the handle and try again.</div>';return}
 const mine=prof&&prof.id===p.id;
 const [followState,followers,following,posts,botRows,rv]=await Promise.all([
  me&&!mine?sb.from("follows").select("followee_id").eq("follower_id",me.id).eq("followee_id",p.id):Promise.resolve({data:[]}),
  q(sb.from("follows").select("follower_id").eq("followee_id",p.id)),
  q(sb.from("follows").select("followee_id").eq("follower_id",p.id)),
  q(sb.from("post_feed").select("id,author_id,body,created_at,likes,handle,display_name,color,system").eq("author_id",p.id).order("created_at",{ascending:false}).limit(30)),
  q(sb.from("bot_cards").select("*").eq("creator_id",p.id)),
  q(sb.from("reviews").select("*,profiles(handle),bots!inner(name,creator_id)").eq("bots.creator_id",p.id).order("created_at",{ascending:false}).limit(30))
 ]);
 const fo=(followState.data||[]).length>0;
 const bs=await attachBacktests(botRows);bots=bs;
 if(seq!==window.__navSeq)return;
 $("view").innerHTML=`<div class="p-head">${mine?`<button class="profile-photo-trigger" aria-label="Profile photo">${av(p.display_name,p.color,p.avatar_url)}</button>`:av(p.display_name,p.color,p.avatar_url)}<div class="profile-copy"><h1>${esc(p.display_name)}</h1><div class="handle-row"><span class="h">@${esc(p.handle)}</span>${p.kyc_status==="verified"?'<em class="src src-verified" title="Government ID checked by Stripe">ID verified</em>':""}</div><p style="margin-top:16px;max-width:56ch;color:var(--ink2);font-size:15px">${esc(p.bio)||"No bio yet."}</p>${me&&!mine?`<button class="btn ${fo?"ghost":""}" id="folBtn" style="margin-top:18px">${fo?"Following":"Follow"}</button>`:""}</div>
 <div class="profile-stats"><div><b>${followers.length}</b><span>Followers</span></div><div><b>${following.length}</b><span>Following</span></div><div class="profile-score">${p.relay_score==null?'<span class="ring" style="--p:0"><span>–</span></span>':ring(p.relay_score)}<span>Tick score</span></div></div></div>
 <div class="profile-tabs" role="tablist"><button class="tab-btn active" data-profile-tab="posts" role="tab" aria-selected="true">Posts</button><button class="tab-btn" data-profile-tab="bots" role="tab" aria-selected="false">Bots</button>${mine?`<button class="tab-btn" data-profile-tab="bookmarks" role="tab" aria-selected="false">Bookmarks</button>`:""}</div>
 <section class="profile-panel" data-profile-panel="posts">${posts.length?`<div class="profile-posts">${posts.map(x=>`<article class="post fpost"><div class="post-head"><div class="who">${av(x.display_name,x.color,x.avatar_url)}<div class="who-txt"><div class="who-top"><a class="lnk handle" data-profile-handle="${esc(p.handle)}" href="/u/${esc(p.handle)}">${esc(x.display_name||p.handle)}</a><span class="post-handle">@${esc(p.handle)} · ${ago(x.created_at)}</span>${x.system?`<span class="seal">${SEAL}Tick</span>`:""}</div></div></div>${postMenu(x,mine)}</div><p class="body">${esc(x.body)}</p>${postMedia(x)}${postActions(x)}<div id="cm-${x.id}"></div></article>`).join("")}</div>`:'<div class="note">No posts yet.</div>'}</section>
 <section class="profile-panel" data-profile-panel="bots" hidden><div class="botlist" role="list"><div class="cards">${bs.length?bs.map(x=>card(x,{noCreator:true})).join(""):'<div class="empty"><b>No bots listed yet</b>Bots this creator lists will show up here.</div>'}</div></div><h2 class="sec-title profile-subtitle">Reviews</h2>${rv.length?rv.map(r=>`<div class="rv"><b>${"★".repeat(r.rating)}</b> <span class="mute">on ${esc(r.bots.name)} by ${esc(r.profiles?.handle)}</span><div>${esc(r.body)}</div></div>`).join(""):'<div class="note">No reviews yet.</div>'}</section>${mine?`<section class="profile-panel" data-profile-panel="bookmarks" hidden><div id="savedPosts"></div></section>`:""}`;
 void recordImpressions(posts);
 document.querySelectorAll("[data-cm]").forEach(b=>b.onclick=()=>comments(b.dataset.cm,b));
 document.querySelectorAll("[data-repost]").forEach(b=>b.onclick=()=>toggleRepost(b.dataset.repost,null,b));
 document.querySelectorAll("[data-bookmark]").forEach(b=>b.onclick=()=>toggleBookmark(b.dataset.bookmark,null,b));
 document.querySelectorAll("[data-share]").forEach(b=>b.onclick=()=>recordShare(b.dataset.share,null,b));
 document.querySelectorAll("[data-like]").forEach(b=>b.onclick=()=>toggleLike(b.dataset.like,b));
 document.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{if(!confirm("Delete this post?"))return;await q(sb.from("posts").delete().eq("id",b.dataset.del));profile(handle)});
 const fb=$("folBtn");if(fb)fb.onclick=async()=>{await q(fo?sb.from("follows").delete().eq("follower_id",me.id).eq("followee_id",p.id):sb.from("follows").insert({follower_id:me.id,followee_id:p.id}));profile(handle)};
 document.querySelectorAll("[data-profile-tab]").forEach(btn=>btn.onclick=async()=>{const tab=btn.dataset.profileTab;document.querySelectorAll("[data-profile-tab]").forEach(x=>{const on=x===btn;x.classList.toggle("active",on);x.setAttribute("aria-selected",on)});document.querySelectorAll("[data-profile-panel]").forEach(x=>x.hidden=x.dataset.profilePanel!==tab);if(tab==="bookmarks"){const panel=$("savedPosts");if(panel&&!panel.dataset.loaded)await loadBookmarksPanel(panel)}});
}

function init(){
 document.addEventListener("click",e=>{const b=e.target.closest("[data-close]");if(b){const d=b.closest("dialog");if(d)d.close();}});
 const wl=$("welcome");if(wl)wl.addEventListener("close",()=>{try{localStorage.setItem("relay_seen","1")}catch{}});
 $("nav").onclick=e=>{const h=e.target.closest("button")?.dataset.h;if(h){history.pushState(null,"","/"+h);route()}};
 const sheet=$("navSheet"),menuBtn=$("menuBtn");
 if(sheet&&menuBtn){
  sheet.innerHTML=[...document.querySelectorAll("#nav button")].map(b=>`<button data-h="${b.dataset.h}"${b.id==="navAdmin"?' style="display:none"':""}>${b.textContent}</button>`).join("");
  const closeSheet=()=>{sheet.classList.remove("open");menuBtn.setAttribute("aria-expanded","false")};
  menuBtn.onclick=()=>{const open=sheet.classList.toggle("open");menuBtn.setAttribute("aria-expanded",open?"true":"false")};
  sheet.onclick=e=>{const b=e.target.closest("button");if(!b)return;closeSheet();history.pushState(null,"","/"+b.dataset.h);route()};
  window.addEventListener("hashchange",closeSheet);
  window.addEventListener("resize",()=>{if(innerWidth>820)closeSheet()});
 }
 window.onhashchange=route;
// Delegated metric controls keep working after creatorView replaces #view.
document.addEventListener("click",e=>{
 const metric=e.target.closest("[data-metric]"), range=e.target.closest("[data-range]");
 if(metric){document.querySelectorAll("[data-metric]").forEach(x=>x.classList.toggle("active",x===metric));const title=document.getElementById("metricTitle"),label=document.getElementById("metricLabel"),note=document.getElementById("metricNote");if(title)title.textContent=metric.dataset.metric==="gross"?"$"+metric.dataset.value:metric.dataset.value;if(label)label.textContent=metric.dataset.label;if(note)note.textContent=metric.dataset.label+" · 30 day view. No historical snapshots have been recorded yet.";}
 if(range){document.querySelectorAll("[data-range]").forEach(x=>x.classList.toggle("on",x===range));const metric=document.querySelector("[data-metric].active"),note=document.getElementById("metricNote");if(note&&metric)note.textContent=metric.dataset.label+" · "+range.dataset.range+" day view. No historical snapshots have been recorded yet.";}
});
 $("view").onclick=e=>{const profileLink=e.target.closest("[data-profile-handle]");if(profileLink){e.preventDefault();go("u/"+encodeURIComponent(profileLink.dataset.profileHandle));return}const c=e.target.closest(".card"),o=e.target.closest("[data-open]");if(c)detail(c.dataset.id);if(o)detail(o.dataset.open);if(e.target.id==="browseBtn")$("list").scrollIntoView({behavior:"smooth"});if(e.target.closest("[data-listbot]")){me?$("upload").showModal():$("auth").showModal()}if(e.target.id==="listBtn"){me?$("upload").showModal():$("auth").showModal()}};
document.addEventListener("click",e=>{const profileLink=e.target.closest("[data-profile-handle]");if(profileLink&&!profileLink.closest("#view")){e.preventDefault();go("u/"+encodeURIComponent(profileLink.dataset.profileHandle));}});
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
 if(!isStaff()){$("view").innerHTML='<div class="empty">Not allowed.</div>';return}
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
async function loadCharts(id,rentalId=null){
 const el=$("eqChart");
 let eq=rentalId?await q(sb.from("rental_snapshots").select("ts,equity").eq("rental_id",rentalId).order("ts").limit(1500)):[];
 const rentalCurve=eq.length>1;
 if(!rentalCurve)eq=await q(sb.from("equity_snapshots").select("ts,equity").eq("bot_id",id).order("ts").limit(1500));
 // Public bot cards expose the sampled paper curve even when the detail-page
 // RLS policy does not expose the underlying equity_snapshots rows.
 if(!rentalCurve && eq.length<2){
  const pub=await q(sb.from("bot_cards").select("spark").eq("id",id).maybeSingle());
  if(Array.isArray(pub?.spark)&&pub.spark.length>1)eq=pub.spark.map((equity,i)=>({ts:Date.now()-((pub.spark.length-1-i)*86400000),equity:Number(equity)}));
 }
 if(el){
  if(eq.length>1){
   const v=eq.map(x=>+x.equity/+eq[0].equity*100);let pk=v[0],dd=0;const d=v.map(x=>{pk=Math.max(pk,x);const r=(x-pk)/pk*100;dd=Math.min(dd,r);return r});
   const dates=eq.map(x=>new Date(x.ts).toLocaleDateString(undefined,{month:"short",day:"numeric"}));
   el.innerHTML=`${areaChart(v,{h:280,anim:true,dates,labels:[dates[0],dates.at(-1)]})}<div class="dd-strip"><div><b>Worst drop from a peak</b><span>${dd.toFixed(1)}%</span></div><svg viewBox="0 0 720 46" preserveAspectRatio="none" style="width:100%;height:46px;display:block" aria-label="Drawdown chart"><polygon points="${poly(d,720,46,Math.min(...d)||-1,0)} 720,0 0,0" fill="var(--loss)" opacity=".18"/><polyline points="${poly(d,720,46,Math.min(...d)||-1,0)}" fill="none" stroke="var(--loss)" stroke-width="1.5" vector-effect="non-scaling-stroke" opacity=".75"/></svg></div>`;
   wireCharts(el)}
  else el.innerHTML='<div class="empty"><b>No curve yet</b>The record builds hourly once a verification run starts.</div>'}
 const fl=await q(sb.from("fills").select("market,side,qty,price,realized_pnl,ts").eq("bot_id",id).order("ts",{ascending:false}).limit(15));
 if(fl.length&&$("trades"))$("trades").innerHTML=`<h3>Recent trades</h3><div style="overflow-x:auto"><table class="trades"><thead><tr><th>Time</th><th>Market</th><th>Side</th><th>Qty</th><th>Price</th><th>P&amp;L</th></tr></thead><tbody>${fl.map(f=>`<tr><td>${new Date(f.ts).toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}</td><td>${esc(f.market)}</td><td class="${f.side==="buy"?"pos":"neg"}">${f.side}</td><td>${Number(f.qty).toPrecision(5)}</td><td>${Number(f.price).toPrecision(5)}</td><td class="${f.realized_pnl>=0?"pos":"neg"}">${f.realized_pnl==null?"":Number(f.realized_pnl).toFixed(2)}</td></tr>`).join("")}</tbody></table></div>`}

async function creatorView(){
 if(!prof){$("view").innerHTML='<div class="empty"><b>Sign in to manage your bots</b>Creators list bots, verify them and set their own prices.<div style="margin-top:14px"><button class="btn" id="needSign">Sign in</button></div></div>';$("needSign").onclick=()=>$("auth").showModal();return}
 const bs=await q(sb.from("bots").select("*").eq("creator_id",prof.id).order("created_at",{ascending:false})),ids=bs.map(b=>b.id);let vs=[],runs=[],cnt=[],st=[];
 const cfg=Object.fromEntries((await q(sb.from("app_config").select("*"))).map(r=>[r.key,r.value])),pay=await q(sb.from("profiles").select("payouts_enabled").eq("id",prof.id).single()),bts=ids.length?await q(sb.from("backtests").select("*").in("bot_id",ids).order("created_at",{ascending:false})):[];
 if(ids.length)[vs,runs,cnt,st]=await Promise.all([q(sb.from("bot_versions").select("bot_id,version").in("bot_id",ids)),q(sb.from("verification_runs").select("bot_id,state,ends_at,result,created_at").in("bot_id",ids).order("created_at",{ascending:false})),q(sb.rpc("my_bot_rentals")),q(sb.from("bot_stats").select("*").in("bot_id",ids))]);
 const per=b=>b.billing_period==="week"?4.33:1,renters=cnt.reduce((n,c)=>n+ +c.active,0),gross=bs.reduce((n,b)=>{const c=cnt.find(x=>x.bot_id===b.id);return n+(c?+c.active:0)*b.price_cents/100*per(b)},0);
 $("view").innerHTML=`<div class="phead"><div><h1>My bots</h1><p>Set prices, track results and keep your listings healthy.</p></div><button class="btn" id="listBtn">List a bot</button></div>
 <div class="creator-kpis" role="tablist" aria-label="Creator metrics"><button type="button" class="creator-kpi active" data-metric="listed" data-value="${bs.length}" data-label="Bots listed"><b>${bs.length}</b><span>Bots listed</span></button><button type="button" class="creator-kpi" data-metric="verified" data-value="${bs.filter(b=>b.verification==="verified").length}" data-label="Verified"><b>${bs.filter(b=>b.verification==="verified").length}</b><span>Verified</span></button><button type="button" class="creator-kpi" data-metric="renters" data-value="${renters}" data-label="Active renters"><b>${renters}</b><span>Active renters</span></button><button type="button" class="creator-kpi" data-metric="gross" data-value="${gross.toFixed(0)}" data-label="Estimated monthly gross"><b>$${gross.toFixed(0)}</b><span>Estimated monthly gross</span></button></div><section class="metric-chart post" id="metricChart"><div class="metric-chart-head"><div><span class="bt-k" id="metricLabel">Bots listed</span><h3 id="metricTitle">${bs.length}</h3></div><div class="metric-range"><button class="on" data-range="30">30d</button><button data-range="90">90d</button><button data-range="365">1y</button></div></div><div class="metric-graph" id="metricGraph"></div><p class="note" id="metricNote">Current snapshot; historical points will appear as the tracking job records them.</p></section>
 ${cfg.payments_enabled==="true"?`<div class="post">${pay.payouts_enabled?'<b>Payouts are active.</b> Rental income goes to your Stripe account, minus the platform fee. <button class="btn ghost" id="earnBtn" style="margin-left:6px">Show earnings</button><div id="earn"></div>':'<b>Get paid.</b> Connect a Stripe account to receive rental income. <button class="btn" id="connBtn" style="margin-left:6px">Connect Stripe</button>'}</div>`:""}
 ${bs.length?bs.map(b=>{const v=vs.filter(x=>x.bot_id===b.id).sort((x,y)=>y.version-x.version),r=runs.find(x=>x.bot_id===b.id),c=cnt.find(x=>x.bot_id===b.id),s=st.find(x=>x.bot_id===b.id),act=c?+c.active:0,bt=bts.find(x=>x.bot_id===b.id),latest=v[0],verifyReady=!!b.current_version_id&&(!latest||["passed","warned"].includes(latest.check_state))&&b.code_check!=="failed",verifyLabel=!b.current_version_id?"Upload code first":latest&&(latest.check_state==="pending"||latest.check_state==="running")?"Code checks running…":b.code_check==="failed"?"Fix code checks":"Start verification";
 return`<section class="post bot-panel" data-bot="${b.id}">
 <div class="bp-head"><div><h3><a href="/bots/${esc(b.slug)}" style="text-decoration:none">${esc(b.name)}</a></h3><div class="note" style="margin-top:5px">${v.length?`Code version ${v[0].version}`:"No code uploaded yet"} · ${act} active renter${act===1?"":"s"}${c&&+c.live?` · ${c.live} live`:""}${b.listed?"":" · delisted"}</div></div><div class="bp-head-end">${badge(b.verification)}</div></div>
 <div class="bp-body">
  <div class="bp-record">
   ${s?`<div class="bp-stats"><div><b class="${s.ret_90d==null?"mute":s.ret_90d>=0?"pos":"neg"}">${s.ret_90d==null?"–":sgn(s.ret_90d)}</b><span>Return</span></div><div><b class="${s.max_dd==null?"mute":""}">${s.max_dd==null?"–":num(s.max_dd)+"%"}</b><span>Max drawdown</span></div><div><b>${s.trades||0}</b><span>Trades</span></div></div>`:'<p class="note" style="margin-bottom:14px">No record yet. A free paper run starts once your bot passes the code checks.</p>'}
   ${r?`<p class="note" style="margin-bottom:12px">Latest run: ${esc(r.state)}${r.result?.fails?.length?". "+esc(r.result.fails.join("; ")):""}${r.state==="running"?`, ends ${new Date(r.ends_at).toLocaleDateString()}`:""}</p>`:""}
   <div class="bp-backtest"><div class="bt-k">30-day backtest</div>${bt?(bt.state==="done"?`<p class="note" style="margin:0 0 10px">${bt.result.days} days, simulated: return ${num(bt.result.ret)}%, drawdown ${num(bt.result.dd)}%, Sharpe ${num(bt.result.sharpe,2)}, ${bt.result.trades} trades. Historical and not verified; beware overfitting.</p>${bt.result.consistent===false?`<p class="note neg" style="margin-bottom:10px">Warning: the second half did much worse than the first (${num(bt.result.halves.first.ret)}% vs ${num(bt.result.halves.second.ret)}%). This pattern often means overfitting.</p>`:""}<svg viewBox="0 0 300 56" preserveAspectRatio="none" style="width:100%;height:56px;display:block;margin-bottom:10px" aria-label="Backtest curve"><polyline points="${poly(bt.result.equity,300,56,Math.min(...bt.result.equity),Math.max(...bt.result.equity))}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`:bt.state==="failed"?`<p class="note neg">Backtest failed: ${esc(bt.error)}</p>`:`<p class="note">Backtest ${esc(bt.state)}. Check back in a minute.</p>`):'<p class="note" style="margin:0 0 10px">Test the bot on recent history before you pay for verification.</p>'}
   ${v.length?`<button class="btn ghost btn-sm" data-bt="${b.id}">Run a 30-day backtest</button>`:""}</div>
  </div>
  <div class="bp-side">
   <div class="bp-price-row"><div><b>${b.price_cents?`$${(b.price_cents/100).toFixed(b.price_cents%100?2:0)}`:"Free"}</b><span class="n">per ${b.billing_period==="week"?"week":"month"}</span></div><div class="chips">${b.markets.slice(0,3).map(m=>`<span class="chip">${esc(m)}</span>`).join("")}${b.markets.length>3?`<span class="chip">+${b.markets.length-3}</span>`:""}</div></div>
   <p class="note" style="margin-bottom:14px">${b.verification_paid?"Verification is paid for. New code versions are re-verified at no cost.":"Replacing the code starts the code checks again."}</p>
   <div class="actions"><label class="btn ghost btn-sm" style="cursor:pointer">Replace code<input type="file" accept=".py" data-replace="${b.id}" hidden></label><button class="btn ghost btn-sm" data-editcode="${b.id}" data-name="${esc(b.name)}">Edit code</button>${b.verification==="none"||b.verification==="failed"?`<button class="btn btn-sm" data-verify="${b.id}" ${verifyReady?"":"disabled"}>${verifyLabel}</button>`:""}<button class="btn ghost btn-sm" data-list="${b.id}" data-on="${b.listed}">${b.listed?"Delist":"List again"}</button><button class="btn ghost btn-sm neg" data-delbot="${b.id}">Delete</button></div>
   <details class="bp-edit"><summary>Edit listing details</summary>
    <label style="display:block;margin-top:12px">Name<input data-f="name" maxlength="40" value="${esc(b.name)}"></label>
    <div class="two" style="margin-top:12px"><label>Price (USD)<input data-f="price" type="number" min="0" step="0.01" value="${b.price_cents/100}"></label><label>Billing<select data-f="bill"><option value="month" ${b.billing_period==="month"?"selected":""}>Per month</option><option value="week" ${b.billing_period==="week"?"selected":""}>Per week</option></select></label></div>
    <label style="display:block;margin-top:12px">Description<textarea data-f="desc" rows="3" maxlength="600">${esc(b.description)}</textarea></label>
    <label style="display:block;margin-top:12px">Markets<input data-f="markets" value="${esc(b.markets.join(", "))}" placeholder="BTC/USDT, ETH/USDT"></label>
    <p class="note" style="margin-top:6px">Use comma-separated markets, for example BTC/USDT, ETH/USDT.</p>
    <button class="btn btn-sm" data-save="${b.id}" style="margin-top:12px">Save changes</button>
   </details>
  </div>
 </div>
</section>`}).join(""):'<div class="empty"><b>You have not listed a bot yet</b>List one, run a backtest, then verify it to earn the seal.</div>'}`;
 const metricValues={listed:bs.length,verified:bs.filter(b=>b.verification==="verified").length,renters:renters,gross:Number(gross.toFixed(0))},metricLabels={listed:"Bots listed",verified:"Verified",renters:"Active renters",gross:"Estimated monthly gross"};const drawMetric=(kind,days)=>{const val=Number(metricValues[kind]||0);$("metricTitle").textContent=kind==="gross"?"$"+val:val;$("metricLabel").textContent=metricLabels[kind];$("metricNote").textContent=metricLabels[kind]+" · "+days+" day view. Current snapshot; historical points will appear as the tracking job records them.";$("metricGraph").innerHTML='<div class="metric-empty">No historical snapshots yet. The graph will appear after Tick records this metric over time.</div>';document.querySelectorAll("[data-metric]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-metric]").forEach(x=>x.classList.toggle("active",x===b));drawMetric(b.dataset.metric,30)});document.querySelectorAll("[data-range]").forEach(b=>b.onclick=()=>{document.querySelectorAll("[data-range]").forEach(x=>x.classList.toggle("on",x===b));drawMetric(document.querySelector("[data-metric].active")?.dataset.metric||"listed",b.dataset.range)});drawMetric("listed",30);
 const eb=$("earnBtn");if(eb)eb.onclick=async()=>{const r=await fn("creator-earnings",{}),$$=x=>(x.amount/100).toFixed(2)+" "+String(x.currency).toUpperCase();
  $("earn").innerHTML=`<div class="note" style="margin-top:10px">Available ${(r.available||[]).map($$).join(", ")||"0"}. Pending ${(r.pending||[]).map($$).join(", ")||"0"}.</div>${(r.payouts||[]).map(p=>`<div class="rv">Payout ${$$(p)}, ${esc(p.status)}, ${new Date(p.arrival*1000).toLocaleDateString()}</div>`).join("")||'<div class="note">No payouts yet.</div>'}<details><summary class="note">Recent transactions</summary>${(r.transactions||[]).map(t=>`<div class="rv">${new Date(t.created*1000).toLocaleDateString()}, ${esc(t.type)}, net ${(t.net/100).toFixed(2)} (fee ${(t.fee/100).toFixed(2)})</div>`).join("")}</details>`};
 const cn=$("connBtn");if(cn)cn.onclick=async()=>{const r=await fn("connect-onboard",{});location.href=r.url};
 document.querySelectorAll("[data-bt]").forEach(b=>b.onclick=async()=>{await q(sb.from("backtests").insert({bot_id:b.dataset.bt,creator_id:prof.id,days:30}));toast("Backtest queued");creatorView()});
 document.querySelectorAll("[data-verify]").forEach(b=>b.onclick=async()=>{
  if(b.disabled)return;
  const original=b.textContent;b.disabled=true;b.textContent="Starting…";
  try{const r=await fn("start-verification",{bot_id:b.dataset.verify});
   if(r?.checkout_url){location.href=r.checkout_url;return}
   if(r?.url){location.href=r.url;return}
   toast("Verification started");await creatorView();
  }catch(e){b.disabled=false;b.textContent=original;toast(e?.message||"Could not start verification")}
 });
 document.querySelectorAll("[data-save]").forEach(b=>b.onclick=async()=>{const box=b.closest("[data-bot]"),g=f=>box.querySelector(`[data-f=${f}]`).value;
  const nm=g("name").trim();if(!nm){toast("Give the bot a name");return}
  const markets=g("markets").split(",").map(x=>x.trim().toUpperCase()).filter(Boolean);
  if(!markets.length||markets.some(x=>!MARKETS.includes(x))){toast("Choose valid markets such as BTC/USDT");return}
  await q(sb.from("bots").update({name:nm,price_cents:Math.round(parseFloat(g("price"))*100),billing_period:g("bill"),description:g("desc"),markets}).eq("id",box.dataset.bot));toast("Changes saved");creatorView()});
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

window.rentalsView=async function renderRentalsView(){
 const seq=window.__navSeq;
 if(!prof){$("view").innerHTML='<div class="empty"><b>Sign in to see your rentals</b>Rentals, results and exchange keys live here.<div style="margin-top:14px"><button class="btn" id="needSign">Sign in</button></div></div>';$("needSign").onclick=()=>$("auth").showModal();return}
 const rs=await q(sb.from("rentals").select("*,bots(name,slug,verification,creator_id,profiles(handle,display_name,color))").eq("renter_id",prof.id).order("started_at",{ascending:false}));
 const keys=await q(sb.from("exchange_connections").select("id,label,key_hint,created_at"));
 const fl=rs.length?await q(sb.from("fills").select("rental_id,market,side,qty,price,realized_pnl,ts").in("rental_id",rs.map(r=>r.id)).order("ts",{ascending:false})):[];const eqs=rs.length?await q(sb.from("rental_snapshots").select("rental_id,ts,equity").in("rental_id",rs.map(r=>r.id)).order("ts")):[];
 $("view").innerHTML=`<div class="phead"><div><h1>My rentals</h1><p>Status, results and broker connections for every bot you rent.</p></div><a class="btn ghost" href="/#/market">Browse bots</a></div>
 ${rs.length?rs.map(r=>{const f=fl.filter(x=>x.rental_id===r.id),pnl=f.reduce((n,x)=>n+(+x.realized_pnl||0),0),ls=r.live_state||{},pos=Object.values(ls.pos||{}).filter(p=>p.qty>0).length,botName=r.bots?.name||"Unavailable bot",botSlug=r.bots?.slug,creator=r.bots?.profiles,creatorName=creator?.display_name||creator?.handle,creatorHandle=creator?.handle;
 return`<section class="post rental-card"><div class="row"><div><h3 style="font-size:19px">${botSlug?`<a href="/bots/${esc(botSlug)}" style="text-decoration:none">${esc(botName)}</a>`:esc(botName)}${creatorName?`<div class="note rental-uploader">Uploaded by <a class="lnk" href="/u/${esc(creatorHandle||creatorName)}">${esc(creatorName)}</a></div>`:""}</h3><div class="note" style="margin-top:6px">Rented ${new Date(r.started_at).toLocaleDateString()} · ${r.price_cents?`$${(r.price_cents/100).toFixed(2)} per ${r.billing_period}`:"free"}${r.cancel_at_period_end?" · ends at period end":""}</div></div><span class="badge ${r.live?"live":""}">${r.status==="cancelled"?"Cancelled":r.live?"Live":"Paper"}</span></div>
 ${r.paused_reason?`<p class="neg" style="margin-top:12px;font-weight:500">Stopped: ${esc(r.paused_reason)}</p>`:""}
 ${ls.cash!=null?`<div class="kpis sm" style="margin-top:16px"><div><b>${r.allocation_usd?"$"+num(r.allocation_usd,0):"Paper"}</b><span>Allocation</span></div><div><b>$${num(ls.cash,2)}</b><span>Cash</span></div><div><b>${pos}</b><span>Open position${pos===1?"":"s"}</span></div><div><b class="${pnl>=0?"pos":"neg"}">${pnl>=0?"+":"-"}$${Math.abs(pnl).toFixed(2)}</b><span>Realized profit, ${f.length} trades</span></div></div>`:""}
 ${(()=>{const curve=eqs.filter(x=>x.rental_id===r.id),vals=curve.map(x=>+x.equity);const pts=vals.length>1?poly(vals.map(v=>v/(vals[0]||1)*100),520,110,Math.min(...vals.map(v=>v/(vals[0]||1)*100)),Math.max(...vals.map(v=>v/(vals[0]||1)*100))):"";return `<div class="rental-equity"><div class="row"><b>Equity curve</b><span class="note">${curve.length>1?curve.length+" snapshots":"Building"}</span></div>${pts?`<svg viewBox="0 0 520 110" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5" vector-effect="non-scaling-stroke"/></svg>`:`<div class="note">Live rental equity begins after the broker worker records the first market snapshot. The sample backtest is not shown here.</div>`}</div>`})()}
 <details class="rental-trades"><summary class="btn ghost">View all trades (${f.length})</summary><div class="trade-history">${f.length?f.map(x=>`<div class="trade-row"><span>${new Date(x.ts).toLocaleString()}</span><b class="${x.side==="buy"?"pos":"neg"}">${esc(x.side||"trade")}</b><span>${esc(x.market||"—")}</span><span>${x.qty==null?"":Number(x.qty).toPrecision(6)} @ ${x.price==null?"":Number(x.price).toPrecision(8)}</span></div>`).join(""):'<div class="note">No trades yet.</div>'}</div></details>
 <div class="rental-actions">${r.live?`<button class="btn ghost" data-stop="${r.id}">Stop live trading</button>`:""}${r.status==="active"?`<button class="btn ghost" data-cancel="${r.id}">Cancel rental</button>`:""}</div></section>`}).join(""):'<div class="empty"><b>You are not renting any bots</b>Try one in paper mode first. It costs nothing and shows how the bot behaves.<div style="margin-top:14px"><a class="btn" href="/#/market">Browse the marketplace</a></div></div>'}
 <h2 class="sec-title">Broker connections</h2>${keys.length?keys.map(k=>`<div class="post row"><span><b>${esc(k.label)}</b> <span class="mute">account ending ${esc(k.key_hint)}, added ${new Date(k.created_at).toLocaleDateString()}</span></span><button class="btn ghost" data-delkey="${k.id}">Remove</button></div>`).join(""):'<div class="note">No broker connected. You can connect Alpaca from the page of a bot you rent.</div>'}
 <h2 class="sec-title">Invoices</h2><button class="btn ghost" id="invBtn">Show invoices</button><div id="inv"></div>`;
 document.querySelectorAll("[data-stop]").forEach(b=>b.onclick=async()=>{await q(sb.from("rentals").update({live:false}).eq("id",b.dataset.stop));toast("Stopping. Positions are sold within 10 minutes");renderRentalsView()});
 document.querySelectorAll("[data-cancel]").forEach(b=>b.onclick=async()=>{if(!confirm("Cancel this rental? Any live positions will be sold."))return;const rr=rs.find(x=>x.id===b.dataset.cancel);if(rr.stripe_subscription_id){await fn("cancel-rental",{rental_id:rr.id});toast("Ends at the end of the billing period")}else await q(sb.from("rentals").update({status:"cancelled",live:false}).eq("id",rr.id));renderRentalsView()});
 const ib=$("invBtn");if(ib)ib.onclick=async()=>{const r=await fn("my-invoices",{});$("inv").innerHTML=(r.invoices||[]).map(i=>`<div class="rv">${new Date(i.created*1000).toLocaleDateString()}, ${esc(i.number||"invoice")}, ${(i.amount/100).toFixed(2)} ${String(i.currency).toUpperCase()}, ${esc(i.status)} ${i.url?`<a class="lnk" href="${esc(i.url)}" target="_blank" rel="noopener">View</a>`:""}</div>`).join("")||'<div class="note" style="margin-top:10px">No invoices yet.</div>'};
 document.querySelectorAll("[data-delkey]").forEach(b=>b.onclick=async()=>{await q(sb.from("exchange_connections").delete().eq("id",b.dataset.delkey));rentalsView()})}

setInterval(()=>{if(me)void refreshBell()},60000);
function init2(){
 const searchDlg=$("userSearch"),searchInput=$("userSearchInput"),searchResults=$("userSearchResults"),searchBox=$("userSearchBox");
 searchBox.hidden=false;
 const runUserSearch=async()=>{const term=searchInput.value.trim().replace(/[%,()]/g," ");if(term.length<2){searchResults.hidden=false;searchResults.innerHTML='<div class="note">Enter at least 2 characters.</div>';return}if(!location.hash.startsWith("#/feed")){history.pushState(null,"","/#/feed");await route()}searchResults.hidden=true;searchResults.innerHTML="";const rows=await q(sb.from("profiles").select("handle,display_name,color,avatar_url,relay_score").or(`display_name.ilike.%${term}%,handle.ilike.%${term}%`).order("display_name").limit(20));searchResults.hidden=false;searchResults.innerHTML=rows.length?rows.map(x=>`<button class="user-result" type="button" data-profile-handle="${esc(x.handle)}">${av(x.display_name,x.color,x.avatar_url)}<span><b>${esc(x.display_name||x.handle)}</b><small>@${esc(x.handle)}</small></span>${x.relay_score!=null?ring(x.relay_score):""}</button>`).join(""):'<div class="note">No users found.</div>'};
 searchInput.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();e.stopPropagation();void runUserSearch()}});$("userSearchIconGo").addEventListener("click",e=>{e.preventDefault();void runUserSearch()});
 $("bellBtn").onclick=async()=>{const ns=await q(sb.from("notifications").select("*").order("created_at",{ascending:false}).limit(30));
  $("notifBody").innerHTML=ns.length?ns.map(n=>`<div class="rv" style="${n.read?"":"font-weight:600"}">${esc(n.body)}${n.link?` <a class="lnk" href="${esc(n.link)}">Open</a>`:""}<div class="note">${new Date(n.created_at).toLocaleString()}</div></div>`).join(""):'<div class="note">No alerts yet.</div>';
  $("notif").showModal();if(ns.some(n=>!n.read)){await sb.from("notifications").update({read:true}).eq("read",false);refreshBell()}};
 $("notifClose").onclick=()=>$('notif').close();$("setBtn").onclick=async()=>{mfaBox();kycBox();const{data}=await sb.from("profiles").select("email_alerts,display_name,bio,color").eq("id",me.id).single();if($("setEmail"))$("setEmail").checked=!!data?.email_alerts;if($("setName"))$("setName").value=data?.display_name||prof?.display_name||"";if($("setBio"))$("setBio").value=data?.bio||"";if($("setColor"))$("setColor").value=data?.color||"#D8FF3E";if($("setAvatar"))$("setAvatar").value="";$("settings").showModal()};$("setEmail").onchange=async()=>{await q(sb.from("profiles").update({email_alerts:$("setEmail").checked}).eq("id",me.id));toast("Saved")};$("setProfileSave").onclick=async()=>{const patch={display_name:$("setName")?.value.trim()||prof?.display_name,bio:$("setBio")?.value.trim()||"",color:$("setColor")?.value||prof?.color||"#5b717a"};await q(sb.from("profiles").update(patch).eq("id",me.id));Object.assign(prof,patch);toast("Profile saved");route()};$("setClose").onclick=()=>$('settings').close();const photoFile=$("photoFile"),photoMenu=$("photoMenu");document.addEventListener("click",e=>{const b=e.target.closest(".profile-photo-trigger");if(!b)return;const img=$("photoPreview");if(img){img.hidden=!prof?.avatar_url;if(prof?.avatar_url)img.src=prof.avatar_url}photoMenu?.showModal()});const photoView=$("photoView");if(photoView)photoView.onclick=()=>{if(prof?.avatar_url)window.open(prof.avatar_url,"_blank","noopener")};if(photoFile)photoFile.onchange=async()=>{const file=photoFile.files?.[0];if(!file)return;if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>2000000){toast("Use a PNG, JPG or WebP image under 2 MB");return}const path=`${me.id}/avatar-${Date.now()}.${file.type.split("/")[1].replace("jpeg","jpg")}`,up=await sb.storage.from("avatars").upload(path,file,{upsert:true,contentType:file.type});if(up.error){toast(up.error.message);return}const pub=sb.storage.from("avatars").getPublicUrl(path).data.publicUrl;await q(sb.from("profiles").update({avatar_url:pub}).eq("id",me.id));prof.avatar_url=pub;photoMenu?.close();toast("Profile photo saved");route()};
 const newPass=async(id,done)=>{const p=$(id).value;if(p.length<8){toast("Use at least 8 characters");return}const{error}=await sb.auth.updateUser({password:p});if(error){toast(error.message);return}$(id).value="";done();toast("Password updated")};
 $("setPass").onclick=()=>newPass("setNew",()=>{});$("rGoPass").onclick=()=>newPass("rNew",()=>$("reset").close());
 $("setDel").onclick=async()=>{if($("setConfirm").value!=="DELETE"){toast("Type DELETE to confirm");return}await fn("delete-account",{});await sb.auth.signOut();$("settings").close();toast("Account deleted")};
 $("aForgot").onclick=async()=>{const email=$("aEmail").value.trim();if(!email){toast("Enter your email first");return}const{error}=await sb.auth.resetPasswordForEmail(email,{redirectTo:location.origin,captchaToken});if(window.turnstile&&CFG.turnstileKey){turnstile.reset();captchaToken=null}toast(error?error.message:"Check your email for a reset link")}}
init2();

async function comments(id,actionButton){const box=$("cm-"+id);if(!box)return;if(box.dataset.open){box.innerHTML="";delete box.dataset.open;return}box.dataset.open="1";
 const inputId="ci-"+id;box.innerHTML=`<div class="comment-list"><div class="note comment-loading">Loading comments…</div></div>${me?`<div class="two comment-compose"><input id="${inputId}" maxlength="280" placeholder="Write a comment"><button class="btn" id="cb-${id}">Send</button></div>`:""}`;
 const render=cs=>{const list=box.querySelector(".comment-list");if(list)list.innerHTML=cs.length?cs.map(c=>`<div class="rv"><b>${esc(c.profiles?.handle||"user")}</b> ${esc(c.body)}</div>`).join(""):'<div class="note">No comments yet.</div>'};
 void q(sb.from("comments").select("*,profiles(handle)").eq("post_id",id).order("created_at")).then(render);
 const cb=$("cb-"+id);if(cb)cb.onclick=async()=>{const input=$(inputId),t=input?.value.trim();if(!t)return;cb.disabled=true;const temp=document.createElement("div");temp.className="rv comment-pending";temp.innerHTML=`<b>${esc(prof?.handle||"you")}</b> ${esc(t)}`;box.querySelector(".comment-list")?.append(temp);input.value="";actionState(actionButton,1);try{const r=await sb.from("comments").insert({post_id:id,author_id:me.id,body:t});if(r.error)throw r.error;temp.classList.remove("comment-pending")}catch(e){temp.remove();actionState(actionButton,-1);toast(e.message||"Could not post comment")}finally{cb.disabled=false}}}
async function loadBookmarksPanel(panel){if(!panel||!me)return;panel.innerHTML='<div class="note">Loading bookmarks…</div>';const marks=await safeRows(sb.from("post_bookmarks").select("post_id,created_at").eq("user_id",me.id).order("created_at",{ascending:false}));const ids=marks.map(x=>x.post_id);const posts=ids.length?await safeRows(sb.from("post_feed").select("*").in("id",ids)):[];const order=new Map(ids.map((id,i)=>[id,i]));posts.sort((a,b)=>(order.get(a.id)||0)-(order.get(b.id)||0));panel.innerHTML=posts.length?`<div class="profile-posts">${posts.map(x=>`<article class="post fpost"><div class="post-head"><div class="who">${av(x.display_name,x.color,x.avatar_url)}<div class="who-txt"><div class="who-top"><a class="lnk handle" data-profile-handle="${esc(x.handle)}" href="/u/${esc(x.handle)}">${esc(x.display_name||x.handle)}</a><span class="post-handle">@${esc(x.handle)} · ${ago(x.created_at)}</span></div></div></div></div><p class="body">${esc(x.body)}</p>${postMedia(x)}${postActions({...x,_bookmarked:true})}<div id="cm-${x.id}"></div></article>`).join("")}</div>`:'<div class="note">You have no bookmarked posts yet.</div>';
 panel.querySelectorAll("[data-cm]").forEach(b=>b.onclick=()=>comments(b.dataset.cm,b));panel.querySelectorAll("[data-like]").forEach(b=>b.onclick=()=>toggleLike(b.dataset.like,b));panel.querySelectorAll("[data-repost]").forEach(b=>b.onclick=()=>toggleRepost(b.dataset.repost,null,b));panel.querySelectorAll("[data-bookmark]").forEach(b=>b.onclick=()=>toggleBookmark(b.dataset.bookmark,null,b));panel.querySelectorAll("[data-share]").forEach(b=>b.onclick=()=>recordShare(b.dataset.share,null,b));panel.dataset.loaded="1"}

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
 const live=((await sb.from("app_config").select("key,value").in("key",["kyc_enabled","live_execution_enabled"])).data||[]).some(r=>r.value==="true");
 const labels={none:"Not verified",pending:"In review",failed:"Not verified: last attempt failed",verified:"Verified"};box.innerHTML=`<div class="note" style="margin-top:14px"><b>Identity</b>: ${labels[st]||labels.none}. ${st==="verified"?"Your ID is verified. Tick keeps only the result, never your documents.":"Verification uses a government ID and a selfie, handled by Stripe. It opens soon and is required before live trading."}</div>${st==="verified"||st==="pending"||!live?"":`<button class="btn ghost" id="kycGo" style="margin-top:8px">Verify identity</button>`}`;
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
 try{const sp=new URLSearchParams(location.search);if(sp.get("alpaca")){toast(sp.get("alpaca")==="ok"?"Alpaca connected. Open a bot you rent to start live trading.":(sp.get("msg")||"Alpaca connection failed"));history.replaceState(null,"",location.pathname+location.hash)}if(sp.get("kyc")==="done"||sp.get("verification")){toast(sp.get("kyc")?"Thanks. Your identity check is being reviewed.":sp.get("verification")==="paid"?"Payment received. Verification starts shortly.":"Checkout cancelled");history.replaceState(null,"",location.pathname+location.hash)}}catch{}
 try{if(!localStorage.getItem("relay_seen")){$("welcome").showModal();$("welcomeOk").onclick=()=>{$("welcome").close();localStorage.setItem("relay_seen","1")}}}catch{}
}
init3();

}
