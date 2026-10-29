import {cors,json,admin,user,hmac} from "../_shared/util.ts";
async function enc(plain:string){
 const raw=Uint8Array.from(atob(Deno.env.get("KEY_ENCRYPTION_SECRET")!),c=>c.charCodeAt(0));
 const k=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt"]),iv=crypto.getRandomValues(new Uint8Array(12));
 const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},k,new TextEncoder().encode(plain)));
 const out=new Uint8Array(12+ct.length);out.set(iv);out.set(ct,12);return btoa(String.fromCharCode(...out))}
async function binance(key:string,secret:string){
 const q=`timestamp=${Date.now()}&recvWindow=10000`,sig=await hmac(secret,q);
 const r=await fetch(`https://api.binance.com/sapi/v1/account/apiRestrictions?${q}&signature=${sig}`,{headers:{"X-MBX-APIKEY":key}});
 if(!r.ok)throw new Error("Exchange rejected this key");return await r.json()}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const u=await user(req);if(!u)return json({error:"Sign in first"},401);
 const b=await req.json().catch(()=>({}));
 if(b.exchange!=="binance")return json({error:"Only Binance is supported so far"},400);
 const key=String(b.api_key??"").trim(),secret=String(b.api_secret??"").trim(),label=String(b.label??"").trim().slice(0,40);
 if(key.length<16||secret.length<16||!label)return json({error:"Missing key, secret or label"},400);
 try{
  if(Deno.env.get("BINANCE_TESTNET")!=="true"){
  const r=await binance(key,secret);
  if(r.enableWithdrawals||r.enableInternalTransfer||r.permitsUniversalTransfer)return json({error:"Disable withdrawals and transfers on this key, then try again"},400);
  if(!r.enableSpotAndMarginTrading)return json({error:"Enable spot trading on this key"},400);
  }
 }catch(e){return json({error:(e as Error).message},400)}
 const{error}=await admin().from("exchange_connections").insert({user_id:u.id,exchange:"binance",label,key_hint:key.slice(-4),api_key_enc:await enc(key),api_secret_enc:await enc(secret),last_checked_at:new Date().toISOString()});
 if(error)return json({error:error.message},500);
 return json({saved:true});
});
