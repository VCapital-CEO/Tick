import {cors,json,admin,user} from "../_shared/util.ts";
import {stripe} from "../_shared/stripe.ts";
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const u=await user(req);if(!u)return json({error:"Sign in first"},401);
 const db=admin();
 try{
  const{data:p}=await db.from("profiles").select("stripe_account_id").eq("id",u.id).single();let acct=p?.stripe_account_id;
  if(!acct){const a=await stripe("accounts",{type:"express","capabilities[transfers][requested]":"true","metadata[user_id]":u.id});acct=a.id;await db.from("profiles").update({stripe_account_id:acct}).eq("id",u.id)}
  const site=Deno.env.get("SITE_URL")!,l=await stripe("account_links",{account:acct,refresh_url:`${site}/#/creator`,return_url:`${site}/#/creator`,type:"account_onboarding"});
  return json({url:l.url});
 }catch(e){return json({error:(e as Error).message},502)}
});
