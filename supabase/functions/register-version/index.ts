import {json,admin,hmac} from "../_shared/util.ts";
// Deploy with --no-verify-jwt. Stripe authenticates with its signature.
// In Stripe, also listen to events on connected accounts so account.updated arrives.
type DB=ReturnType<typeof admin>;
async function verificationPaid(db:DB,s:any){
 const{data:pay}=await db.from("payments").select("*").eq("provider_ref",s.id).maybeSingle();
 if(!pay||pay.state==="paid"||s.payment_status!=="paid")return;
 await db.from("payments").update({state:"paid"}).eq("id",pay.id);
 const m=s.metadata;
 await db.rpc("start_verification_run",{p_bot:m.bot_id,p_version:m.version_id,p_fee:pay.amount_cents,p_payment:pay.id})}
async function subscribed(db:DB,s:any){
 const m=s.metadata;if(!m?.bot_id||!m?.renter_id)return;
 if(s.customer)await db.from("profiles").update({stripe_customer_id:s.customer}).eq("id",m.renter_id);
 const{data:b}=await db.from("bots").select("price_cents,billing_period").eq("id",m.bot_id).single();
 const{data:ex}=await db.from("rentals").select("id").eq("bot_id",m.bot_id).eq("renter_id",m.renter_id).maybeSingle();
 if(ex)await db.from("rentals").update({status:"active",stripe_subscription_id:s.subscription,cancel_at_period_end:false,paused_reason:null,price_cents:b!.price_cents,billing_period:b!.billing_period}).eq("id",ex.id);
 else await db.from("rentals").insert({bot_id:m.bot_id,renter_id:m.renter_id,stripe_subscription_id:s.subscription})}
Deno.serve(async req=>{
 const raw=await req.text(),sig=req.headers.get("stripe-signature")??"";
 const p=Object.fromEntries(sig.split(",").map(x=>x.split("=") as [string,string])),t=p.t;
 if(!t||Math.abs(Date.now()/1000-Number(t))>300)return json({error:"stale"},400);
 if(await hmac(Deno.env.get("STRIPE_WEBHOOK_SECRET")!,`${t}.${raw}`)!==p.v1)return json({error:"bad signature"},400);
 const ev=JSON.parse(raw),o=ev.data.object,db=admin();
 try{
  if(ev.type==="checkout.session.completed")await(o.mode==="subscription"?subscribed(db,o):verificationPaid(db,o));
  else if(ev.type==="customer.subscription.deleted")await db.from("rentals").update({status:"cancelled",live:false,paused_reason:"Subscription ended"}).eq("stripe_subscription_id",o.id);
  else if(ev.type==="customer.subscription.updated"&&["past_due","unpaid"].includes(o.status))await db.from("rentals").update({live:false,paused_reason:"Payment failed"}).eq("stripe_subscription_id",o.id).eq("live",true);
  else if(ev.type==="charge.dispute.created")await db.from("audit_log").insert({action:`dispute ${o.id} ${o.amount} ${o.reason}`,target:String(o.payment_intent??o.charge)});
  else if(ev.type==="account.updated")await db.from("profiles").update({payouts_enabled:!!(o.charges_enabled&&o.payouts_enabled)}).eq("stripe_account_id",o.id);
 }catch(e){return json({error:(e as Error).message},500)}
 return json({ok:true});
});