import {cors,json,admin,user} from "../_shared/util.ts";
import {stripeGet} from "../_shared/stripe.ts";
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const u=await user(req);if(!u)return json({error:"Sign in first"},401);
 const{data:p}=await admin().from("profiles").select("stripe_customer_id").eq("id",u.id).single();
 if(!p?.stripe_customer_id)return json({invoices:[]});
 try{const r=await stripeGet(`invoices?customer=${encodeURIComponent(p.stripe_customer_id)}&limit=20`);
  return json({invoices:(r.data??[]).map((i:any)=>({number:i.number,amount:i.amount_paid,currency:i.currency,status:i.status,created:i.created,url:i.hosted_invoice_url}))});
 }catch(e){return json({error:(e as Error).message},502)}
});
