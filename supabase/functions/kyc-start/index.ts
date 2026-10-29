import {cors,json,admin,user,config} from "../_shared/util.ts";
import {stripe} from "../_shared/stripe.ts";
// Starts a Stripe Identity check (government ID plus selfie). Stripe hosts the capture; Tick keeps only the result.
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const u=await user(req);if(!u)return json({error:"Sign in first"},401);
 const db=admin();
 // Each check costs Tick money with Stripe, so checks only open once real-money trading is switched on.
 if((await config(db)).live_execution_enabled!=="true")return json({error:"Identity verification opens when live trading launches"},409);
 const{data:p}=await db.from("profiles").select("kyc_status").eq("id",u.id).maybeSingle();
 if(!p)return json({error:"Profile not found"},404);
 if(p.kyc_status==="verified")return json({error:"Your identity is already verified"},409);
 const site=Deno.env.get("SITE_URL")!;
 try{
  const s=await stripe("identity/verification_sessions",{type:"document","options[document][require_matching_selfie]":"true","options[document][require_live_capture]":"true",
   "metadata[user_id]":u.id,return_url:`${site}/?kyc=done`});
  await db.from("kyc_sessions").insert({session_id:s.id,user_id:u.id});
  await db.rpc("set_kyc",{p_user:u.id,p_session:s.id,p_status:"pending"});
  return json({url:s.url});
 }catch(e){return json({error:(e as Error).message},502)}
});