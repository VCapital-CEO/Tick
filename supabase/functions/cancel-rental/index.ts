import {cors,json,admin,user} from "../_shared/util.ts";
import {stripe} from "../_shared/stripe.ts";
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const u=await user(req);if(!u)return json({error:"Sign in first"},401);
 const{rental_id}=await req.json().catch(()=>({}));const db=admin();
 const{data:r}=await db.from("rentals").select("id,stripe_subscription_id").eq("id",rental_id).eq("renter_id",u.id).maybeSingle();
 if(!r?.stripe_subscription_id)return json({error:"Rental not found"},404);
 try{await stripe(`subscriptions/${r.stripe_subscription_id}`,{cancel_at_period_end:"true"})}catch(e){return json({error:(e as Error).message},502)}
 await db.from("rentals").update({cancel_at_period_end:true}).eq("id",r.id);
 return json({ok:true});
});
