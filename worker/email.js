const FROM=process.env.FROM_EMAIL||"Relay <onboarding@resend.dev>";
async function send(to,subject,text){
 const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${process.env.RESEND_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({from:FROM,to,subject,text})});
 return r.ok}
export async function sendEmails(db){
 if(!process.env.RESEND_API_KEY)return;
 const{data:ns}=await db.from("notifications").select("id,user_id,body,link").eq("emailed",false).order("created_at").limit(40);
 for(const n of ns??[]){
  const{data:p}=await db.from("profiles").select("email_alerts").eq("id",n.user_id).maybeSingle();let ok=true;
  if(p?.email_alerts){const{data:u}=await db.auth.admin.getUserById(n.user_id),to=u?.user?.email;
   if(to)ok=await send(to,"Relay: "+n.body.slice(0,70),`${n.body}\n\n${process.env.SITE_URL||""}${n.link||""}\n\nYou can turn these emails off in Relay Settings.`)}
  if(ok)await db.from("notifications").update({emailed:true}).eq("id",n.id)}}
