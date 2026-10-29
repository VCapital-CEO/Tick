import {createClient} from "https://esm.sh/@supabase/supabase-js@2.45.4";
export const cors={"Access-Control-Allow-Origin":Deno.env.get("SITE_URL")??"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
export const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,"Content-Type":"application/json"}});
export const admin=()=>createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
export async function user(req:Request){const t=(req.headers.get("Authorization")??"").replace("Bearer ","");if(!t)return null;const{data}=await admin().auth.getUser(t);return data.user}
export async function config(db:ReturnType<typeof admin>){const{data}=await db.from("app_config").select("key,value");return Object.fromEntries((data??[]).map((r:any)=>[r.key,r.value]))}
export const hex=(b:ArrayBuffer)=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("");
export async function hmac(secret:string,msg:string){const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return hex(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(msg)))}
