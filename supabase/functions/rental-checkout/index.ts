import {cors,json,admin,user,config} from "../_shared/util.ts";
import {stripe} from "../_shared/stripe.ts";
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const u=await user(req);if(!u)return json({error:"Sign in first"},401);
 const{bot_id}=await req.json().catch(()=>({}));const db=admin(),cfg=await config(db);
 if(cfg.payments_enabled!=="true")return json({error:"Payments are not enabled"},409);
 const{data:b}=await db.from("bots").select("id,name,slug,price_cents,billing_period,listed,creator_id,profiles(stripe_account_id,payouts_enabled)").eq("id",bot_id).maybeSingle();
 if(!b||!b.listed)return json({error:"Bot not found"},404);
 if(b.creator_id===u.id)return json({error:"You cannot rent your own bot"},409);
 if(b.price_cents<=0)return json({error:"This bot is free"},409);
 const pr=b.profiles as unknown as {stripe_account_id:string|null,payouts_enabled:boolean};
 if(!pr?.payouts_enabled||!pr.stripe_account_id)return json({error:"The creator has not finished payout setup yet"},409);
 const{data:ex}=await db.from("rentals").select("status").eq("bot_id",b.id).eq("renter_id",u.id).maybeSingle();
 if(ex?.status==="active")return json({error:"You already rent this bot"},409);
 const site=Deno.env.get("SITE_URL")!;
 try{
  const s=await stripe("checkout/sessions",{mode:"subscription",customer_email:u.email??"",client_reference_id:u.id,
   "line_items[0][quantity]":"1","line_items[0][price_data][currency]":"usd","line_items[0][price_data][unit_amount]":String(b.price_cents),
   "line_items[0][price_data][recurring][interval]":b.billing_period,"line_items[0][price_data][product_data][name]":`Tick rental: ${b.name}`,
   "subscription_data[application_fee_percent]":cfg.platform_fee_pct??"15","subscription_data[transfer_data][destination]":pr.stripe_account_id,
   "subscription_data[metadata][bot_id]":b.id,"subscription_data[metadata][renter_id]":u.id,"metadata[bot_id]":b.id,"metadata[renter_id]":u.id,
   success_url:`${site}/#/rentals`,cancel_url:`${site}/bots/${b.slug}`});
  return json({checkout_url:s.url});
 }catch(e){return json({error:(e as Error).message},502)}
});