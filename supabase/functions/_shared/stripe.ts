export async function stripe(path:string,body?:Record<string,string>){
 const r=await fetch(`https://api.stripe.com/v1/${path}`,{method:"POST",headers:{Authorization:`Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}`,"Content-Type":"application/x-www-form-urlencoded"},body:body?new URLSearchParams(body):undefined});
 const j=await r.json();if(!r.ok)throw new Error(j.error?.message??"Payment provider error");return j}
export async function stripeGet(path:string,account?:string){
 const h:Record<string,string>={Authorization:`Bearer ${Deno.env.get("STRIPE_SECRET_KEY")}`};if(account)h["Stripe-Account"]=account;
 const r=await fetch(`https://api.stripe.com/v1/${path}`,{headers:h}),j=await r.json();if(!r.ok)throw new Error(j.error?.message??"Payment provider error");return j}
