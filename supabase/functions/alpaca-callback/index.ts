import {admin} from "../_shared/util.ts";
// Alpaca sends the browser back here with a one-time code. Deployed without JWT verification: the single-use state value is the proof of who started it.
async function enc(plain:string){
 const raw=Uint8Array.from(atob(Deno.env.get("KEY_ENCRYPTION_SECRET")!),c=>c.charCodeAt(0));
 const k=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt"]),iv=crypto.getRandomValues(new Uint8Array(12));
 const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},k,new TextEncoder().encode(plain)));
 const out=new Uint8Array(12+ct.length);out.set(iv);out.set(ct,12);return btoa(String.fromCharCode(...out))}
const back=(site:string,ok:boolean,msg="")=>new Response(null,{status:302,headers:{Location:`${site}/?alpaca=${ok?"ok":"err"}${msg?"&msg="+encodeURIComponent(msg.slice(0,120)):""}`}});
Deno.serve(async req=>{
 const site=Deno.env.get("SITE_URL")!,url=new URL(req.url),code=url.searchParams.get("code"),state=url.searchParams.get("state");
 if(url.searchParams.get("error")||!code||!state)return back(site,false,"Alpaca connection was cancelled");
 const db=admin();
 const{data:st}=await db.from("oauth_states").delete().eq("state",state).select("user_id,created_at").maybeSingle();
 if(!st||Date.now()-new Date(st.created_at).getTime()>15*60e3)return back(site,false,"This link expired. Try again");
 try{
  const t=await fetch("https://api.alpaca.markets/oauth/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",code,client_id:Deno.env.get("ALPACA_CLIENT_ID")!,client_secret:Deno.env.get("ALPACA_CLIENT_SECRET")!,redirect_uri:`${Deno.env.get("SUPABASE_URL")}/functions/v1/alpaca-callback`})});
  const tj=await t.json();if(!t.ok||!tj.access_token)return back(site,false,"Alpaca did not accept the connection");
  if(!String(tj.scope??"").split(" ").includes("trading"))return back(site,false,"Trading permission was not granted");
  const a=await fetch("https://api.alpaca.markets/v2/account",{headers:{Authorization:`Bearer ${tj.access_token}`}});
  if(!a.ok)return back(site,false,"Could not read your Alpaca account");
  const acct=await a.json();
  if(acct.status!=="ACTIVE"||acct.trading_blocked||acct.account_blocked)return back(site,false,"Your Alpaca account is not active for trading");
  const hint=String(acct.account_number??"").slice(-4)||"live";
  const row={user_id:st.user_id,exchange:"alpaca",label:`Alpaca ${hint}`,key_hint:hint,api_key_enc:await enc(tj.access_token),api_secret_enc:await enc("oauth"),last_checked_at:new Date().toISOString()};
  const{data:ex}=await db.from("exchange_connections").select("id").eq("user_id",st.user_id).eq("exchange","alpaca").eq("key_hint",hint).maybeSingle();
  const{error}=ex?await db.from("exchange_connections").update({api_key_enc:row.api_key_enc,last_checked_at:row.last_checked_at}).eq("id",ex.id):await db.from("exchange_connections").insert(row);
  if(error)return back(site,false,"Could not save the connection");
  return back(site,true);
 }catch{return back(site,false,"Alpaca connection failed")}
});