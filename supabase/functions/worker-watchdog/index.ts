import {json,admin} from "../_shared/util.ts";
import {sendEmail} from "../_shared/email.ts";
// Call every 5-10 minutes from a free uptime monitor: .../functions/v1/worker-watchdog?s=WATCHDOG_SECRET
// Deploy with --no-verify-jwt. Treat the URL as a secret.
Deno.serve(async req=>{
 if(new URL(req.url).searchParams.get("s")!==Deno.env.get("WATCHDOG_SECRET"))return json({error:"no"},401);
 const db=admin(),{data}=await db.from("worker_lock").select("beat").maybeSingle();
 const mins=data?(Date.now()-new Date(data.beat).getTime())/60000:null,dead=mins===null||mins>30;
 if(dead){
  const{data:last}=await db.from("app_config").select("value").eq("key","watchdog_last_alert").maybeSingle();
  if(!last||Date.now()-Number(last.value)>6*3600e3){
   await sendEmail(Deno.env.get("ADMIN_EMAIL")!,"Relay worker is down",`No worker heartbeat for ${mins===null?"ever":Math.round(mins)+" minutes"}. Live rentals are unattended until it is back.`);
   await db.from("app_config").upsert({key:"watchdog_last_alert",value:String(Date.now())})}}
 return json({dead,mins});
});
