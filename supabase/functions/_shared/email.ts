export async function sendEmail(to:string,subject:string,text:string){
 const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${Deno.env.get("RESEND_API_KEY")}`,"Content-Type":"application/json"},body:JSON.stringify({from:Deno.env.get("FROM_EMAIL")??"Relay <onboarding@resend.dev>",to,subject,text})});
 return r.ok}
