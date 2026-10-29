// Tests the payment-handling functions: webhook signatures and effects, and the rental checkout guards.
import {calls,responses,reset,authUser} from "./stub_supabase.ts";
const eq=(a:unknown,b:unknown,m="")=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)};
const ok=(c:unknown,m="assertion failed")=>{if(!c)throw new Error(m)};
Deno.env.set("SUPABASE_URL","http://x");Deno.env.set("SUPABASE_SERVICE_ROLE_KEY","k");Deno.env.set("SITE_URL","https://relay.test");
Deno.env.set("STRIPE_WEBHOOK_SECRET","whsec_platform, whsec_connect");Deno.env.set("STRIPE_SECRET_KEY","sk_test_x");
const handlers:Record<string,(r:Request)=>Promise<Response>>={};
let current="";
(Deno as any).serve=(h:any)=>{handlers[current]=h};
current="webhook";await import("../payments-webhook/index.ts");
current="checkout";await import("../rental-checkout/index.ts");

async function sign(secret:string,t:number,body:string){
 const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return [...new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(`${t}.${body}`)))].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function send(event:unknown,{secret="whsec_platform",age=0,tamper=false}={}){
 const body=JSON.stringify(event),t=Math.floor(Date.now()/1000)-age,sig=await sign(secret,t,body);
 return handlers.webhook(new Request("http://x/hook",{method:"POST",headers:{"stripe-signature":`t=${t},v1=${tamper?"0".repeat(64):sig}`},body}))}
async function hook(event:unknown,o={}){reset();return send(event,o)}
const sub={type:"checkout.session.completed",data:{object:{mode:"subscription",subscription:"sub_1",customer:"cus_1",metadata:{bot_id:"b1",renter_id:"u1"}}}};
const has=(table:string,op:string)=>calls.find(c=>c.table===table&&c.op===op);

Deno.test("webhook rejects a bad signature",async()=>{eq((await hook(sub,{tamper:true})).status,400);eq(calls.length,0,"no database writes")});
Deno.test("webhook rejects a stale timestamp",async()=>{eq((await hook(sub,{age:3600})).status,400);eq(calls.length,0)});
Deno.test("webhook rejects a signature from an unknown secret",async()=>{eq((await hook(sub,{secret:"whsec_other"})).status,400)});
Deno.test("webhook accepts either configured secret",async()=>{eq((await hook(sub,{secret:"whsec_platform"})).status,200);eq((await hook(sub,{secret:"whsec_connect"})).status,200)});
Deno.test("a new subscription creates the rental and saves the customer id",async()=>{
 reset();responses["bots.select"]={price_cents:4900,billing_period:"month"};
 eq((await send(sub)).status,200);const ins=has("rentals","insert");ok(ins,"rental insert missing");
 eq((ins!.payload as any).stripe_subscription_id,"sub_1");eq((ins!.payload as any).renter_id,"u1");
 eq((has("profiles","update")!.payload as any).stripe_customer_id,"cus_1")});
Deno.test("a repeat subscription reactivates the existing rental instead of duplicating it",async()=>{
 reset();responses["bots.select"]={price_cents:4900,billing_period:"month"};responses["rentals.select"]={id:"r9"};
 await send(sub);ok(!has("rentals","insert"),"must not insert again");const up=has("rentals","update");ok(up,"update missing");eq((up!.payload as any).status,"active");eq(up!.filters.id,"r9")});
Deno.test("an ended subscription cancels the rental and stops live trading",async()=>{
 const r=await hook({type:"customer.subscription.deleted",data:{object:{id:"sub_1"}}});eq(r.status,200);
 const up=has("rentals","update")!;eq((up.payload as any).status,"cancelled");eq((up.payload as any).live,false);eq(up.filters.stripe_subscription_id,"sub_1")});
Deno.test("a past-due subscription stops live trading but keeps the rental",async()=>{
 await hook({type:"customer.subscription.updated",data:{object:{id:"sub_1",status:"past_due"}}});
 const up=has("rentals","update")!;eq((up.payload as any).live,false);eq((up.payload as any).paused_reason,"Payment failed");ok(!("status" in (up.payload as any)),"status untouched")});
Deno.test("an active subscription update changes nothing",async()=>{await hook({type:"customer.subscription.updated",data:{object:{id:"sub_1",status:"active"}}});eq(calls.length,0)});
Deno.test("a paid verification fee starts a run once",async()=>{
 const ev={type:"checkout.session.completed",data:{object:{id:"cs_1",mode:"payment",payment_status:"paid",metadata:{bot_id:"b1",version_id:"v1"}}}};
 reset();responses["payments.select"]={id:"p1",state:"requires_action",amount_cents:1500};await send(ev);
 ok(has("verification_runs","insert"),"run missing");eq((has("bots","update")!.payload as any).verification,"pending");
 reset();responses["payments.select"]={id:"p1",state:"paid",amount_cents:1500};await send(ev);   // Stripe retries the same event
 ok(!has("verification_runs","insert"),"a retried event must not start a second run")});
Deno.test("an unpaid checkout does not start verification",async()=>{
 reset();responses["payments.select"]={id:"p2",state:"requires_action",amount_cents:1500};
 await send({type:"checkout.session.completed",data:{object:{id:"cs_2",mode:"payment",payment_status:"unpaid",metadata:{bot_id:"b1",version_id:"v1"}}}});
 ok(!has("verification_runs","insert"))});
Deno.test("disputes are written to the admin log",async()=>{
 await hook({type:"charge.dispute.created",data:{object:{id:"dp_1",amount:4900,reason:"fraudulent",payment_intent:"pi_1"}}});
 ok(String((has("audit_log","insert")!.payload as any).action).startsWith("dispute dp_1"),"dispute not logged")});
Deno.test("account.updated turns creator payouts on only when both capabilities are on",async()=>{
 await hook({type:"account.updated",data:{object:{id:"acct_1",charges_enabled:true,payouts_enabled:false}}});eq((has("profiles","update")!.payload as any).payouts_enabled,false);
 await hook({type:"account.updated",data:{object:{id:"acct_1",charges_enabled:true,payouts_enabled:true}}});eq((has("profiles","update")!.payload as any).payouts_enabled,true)});
Deno.test("unknown events are accepted and ignored",async()=>{eq((await hook({type:"invoice.created",data:{object:{}}})).status,200);eq(calls.length,0)});

// ---- rental checkout guards
const bot={id:"b1",name:"Ridge",slug:"ridge",price_cents:4900,billing_period:"month",listed:true,creator_id:"c1",profiles:{stripe_account_id:"acct_c1",payouts_enabled:true}};
async function checkout(setup:()=>void,token="good"){
 reset();responses["app_config.select"]=[{key:"payments_enabled",value:"true"},{key:"platform_fee_pct",value:"15"}];responses["bots.select"]=bot;setup();
 return handlers.checkout(new Request("http://x",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({bot_id:"b1"})}))}
Deno.test("checkout needs a signed-in user",async()=>{eq((await checkout(()=>{},"bad")).status,401)});
Deno.test("checkout is refused while payments are off",async()=>{eq((await checkout(()=>{responses["app_config.select"]=[{key:"payments_enabled",value:"false"}]})).status,409)});
Deno.test("checkout refuses your own bot, free bots and unfinished creator payouts",async()=>{
 eq((await checkout(()=>{authUser.current={id:"c1",email:"c@x"}})).status,409);authUser.current={id:"u1",email:"renter@example.test"};
 eq((await checkout(()=>{responses["bots.select"]={...bot,price_cents:0}})).status,409);
 eq((await checkout(()=>{responses["bots.select"]={...bot,profiles:{stripe_account_id:"acct_c1",payouts_enabled:false}}})).status,409)});
Deno.test("checkout refuses a second active rental of the same bot",async()=>{eq((await checkout(()=>{responses["rentals.select"]={status:"active"}})).status,409)});
Deno.test("checkout sends the right subscription to Stripe: price, fee, destination, metadata",async()=>{
 let sent:URLSearchParams|null=null;const real=globalThis.fetch;
 globalThis.fetch=(async(_u:unknown,init:any)=>{sent=new URLSearchParams(init.body);return new Response(JSON.stringify({url:"https://checkout.stripe.test/s"}),{status:200})}) as any;
 try{const r=await checkout(()=>{});eq(r.status,200);eq((await r.json()).checkout_url,"https://checkout.stripe.test/s");
  const p=sent!;eq(p.get("mode"),"subscription");eq(p.get("line_items[0][price_data][unit_amount]"),"4900");eq(p.get("line_items[0][price_data][recurring][interval]"),"month");
  eq(p.get("subscription_data[application_fee_percent]"),"15");eq(p.get("subscription_data[transfer_data][destination]"),"acct_c1");
  eq(p.get("subscription_data[metadata][renter_id]"),"u1");eq(p.get("subscription_data[metadata][bot_id]"),"b1");eq(p.get("cancel_url"),"https://relay.test/bots/ridge")}
 finally{globalThis.fetch=real}});