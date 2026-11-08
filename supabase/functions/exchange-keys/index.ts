import {cors,json,admin,user,hmac} from "../_shared/util.ts";
async function enc(plain:string){
 const raw=Uint8Array.from(atob(Deno.env.get("KEY_ENCRYPTION_SECRET")!),c=>c.charCodeAt(0));
 const k=await crypto.subtle.importKey("raw",raw,"AES-GCM",false,["encrypt"]),iv=crypto.getRandomValues(new Uint8Array(12));
 const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},k,new TextEncoder().encode(plain)));
 const out=new Uint8Array(12+ct.length);out.set(iv);out.set(ct,12);return btoa(String.fromCharCode(...out))}
async function kraken(key:string,secret:string){
 const nonce=Date.now(),body=new URLSearchParams({nonce:String(nonce)}).toString(),path="/0/private/GetApiKeyInfo";
 let sig:string;
 try{
  const sha=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(nonce+body)));
  const msg=new Uint8Array([...new TextEncoder().encode(path),...sha]);
  const k=await crypto.subtle.importKey("raw",Uint8Array.from(atob(secret),c=>c.charCodeAt(0)),{name:"HMAC",hash:"SHA-512"},false,["sign"]);
  sig=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC",k,msg))));
 }catch{throw new Error("That private key does not look right")}
 const r=await fetch("https://api.kraken.com"+path,{method:"POST",headers:{"API-Key":key,"API-Sign":sig,"Content-Type":"application/x-www-form-urlencoded"},body});
 const j=await r.json().catch(()=>({error:["bad response"]}));
 if(!r.ok||j.error?.length)throw new Error("The exchange rejected this key. Check the key and secret");
 return j.result}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const u=await user(req);if(!u)return json({error:"Sign in first"},401);
 const b=await req.json().catch(()=>({}));
 if(b.exchange!=="kraken")return json({error:"Only Kraken is supported right now"},400);
 const key=String(b.api_key??"").trim(),secret=String(b.api_secret??"").trim(),label=String(b.label??"").trim().slice(0,40);
 if(key.length<16||secret.length<16||!label)return json({error:"Missing key, secret or label"},400);
 try{
  const r=await kraken(key,secret),perms:string[]=r.permissions??r.permissions_list??[];
  if(!Array.isArray(perms)||!perms.length)return json({error:"Could not read this key's permissions"},400);
  if(perms.includes("withdraw-funds")||perms.includes("add-withdraw-address")||perms.includes("update-withdraw-address"))return json({error:"This key can withdraw funds. Create a new key without any withdrawal permission, then try again"},400);
  const need=["query-funds","modify-trades","query-open-trades","query-closed-trades","close-trades"],miss=need.filter(x=>!perms.includes(x));
  if(miss.length)return json({error:"This key is missing permissions: "+miss.join(", ")},400);
  if(Array.isArray(r.ip_allowlist)&&r.ip_allowlist.length)return json({error:"Remove the IP restriction from this key, because Tick's servers change address"},400);
 }catch(e){return json({error:(e as Error).message},400)}
 const{error}=await admin().from("exchange_connections").insert({user_id:u.id,exchange:"kraken",label,key_hint:key.slice(-4),api_key_enc:await enc(key),api_secret_enc:await enc(secret),last_checked_at:new Date().toISOString()});
 if(error)return json({error:error.message},500);
 return json({saved:true});
});