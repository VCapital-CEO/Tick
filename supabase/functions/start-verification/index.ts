import {cors,json,admin,user,config} from "../_shared/util.ts";
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const u=await user(req);if(!u)return json({error:"Sign in first"},401);
 const{bot_id}=await req.json().catch(()=>({}));const db=admin();
 const{data:bot}=await db.from("bots").select("id,creator_id,name,current_version_id,verification,verification_paid").eq("id",bot_id).maybeSingle();
 if(!bot||bot.creator_id!==u.id)return json({error:"Bot not found"},404);
 if(!bot.current_version_id)return json({error:"Upload bot code first"},409);
 if(bot.verification==="verified")return json({error:"Already verified. Upload a new version to re-verify"},409);
 const{data:act}=await db.from("verification_runs").select("id").eq("bot_id",bot.id).eq("kind","verification").in("state",["pending","running"]);
 if(act?.length)return json({error:"A run is already in progress"},409);
 const{data:ver}=await db.from("bot_versions").select("check_state,check_report").eq("id",bot.current_version_id).single();
 if(!ver||ver.check_state==="pending"||ver.check_state==="running")return json({error:"Code checks are still running. Try again in a few minutes."},409);
 if(ver.check_state==="failed"){const why=(ver.check_report?.findings??[]).filter((f:any)=>f.level==="block").map((f:any)=>f.msg).slice(0,3).join(" | ");
  return json({error:"This version failed the code checks and cannot be verified: "+why},409)}
 const cfg=await config(db),fee=parseInt(cfg.verification_fee_cents??"1500");
 if(cfg.payments_enabled==="true"&&!bot.verification_paid){ // paid once: later versions are re-verified for free
  const site=Deno.env.get("SITE_URL")!,b=new URLSearchParams({mode:"payment",success_url:`${site}/?verification=paid`,cancel_url:`${site}/?verification=cancelled`,client_reference_id:u.id,
   "line_items[0][quantity]":"1","line_items[0][price_data][currency]":"usd","line_items[0][price_data][unit_amount]":String(fee),
   "line_items[0][price_data][product_data][name]":`Tick verification: ${bot.name}`,"metadata[bot_id]":bot.id,"metadata[user_id]":u.id,"metadata[version_id]":bot.current_version_id});
  const r=await fetch("https://api.stripe.com/v1/checkout/sessions",{method:"POST",headers:{Authorization:`Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}`,"Content-Type":"application/x-www-form-urlencoded"},body:b});
  const s=await r.json();if(!r.ok)return json({error:"Payment provider error"},502);
  await db.from("payments").insert({user_id:u.id,kind:"verification_fee",amount_cents:fee,provider:"stripe",provider_ref:s.id,state:"requires_action",bot_id:bot.id});
  return json({checkout_url:s.url});
 }
 const{data:r,error}=await db.rpc("start_verification_run",{p_bot:bot.id,p_version:bot.current_version_id,p_fee:0,p_payment:null});
 if(error||r==="busy")return json({error:error?.message??"A run is already in progress"},409);
 return json({started:true});
});