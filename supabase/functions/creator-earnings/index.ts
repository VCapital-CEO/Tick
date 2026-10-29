import {cors,json,admin,user} from "../_shared/util.ts";
import {stripeGet} from "../_shared/stripe.ts";
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const u=await user(req);if(!u)return json({error:"Sign in first"},401);
 const{data:p}=await admin().from("profiles").select("stripe_account_id").eq("id",u.id).single();
 const a=p?.stripe_account_id;if(!a)return json({connected:false});
 try{
  const[bal,pay,tx]=await Promise.all([stripeGet("balance",a),stripeGet("payouts?limit=15",a),stripeGet("balance_transactions?limit=20",a)]);
  const m=(x:any)=>({amount:x.amount,currency:x.currency});
  return json({connected:true,available:(bal.available??[]).map(m),pending:(bal.pending??[]).map(m),
   payouts:(pay.data??[]).map((x:any)=>({...m(x),status:x.status,arrival:x.arrival_date})),
   transactions:(tx.data??[]).map((x:any)=>({amount:x.amount,net:x.net,fee:x.fee,type:x.type,created:x.created,description:x.description}))});
 }catch(e){return json({error:(e as Error).message},502)}
});
