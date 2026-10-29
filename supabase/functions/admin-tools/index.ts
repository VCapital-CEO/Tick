import {cors,json,admin,user} from "../_shared/util.ts";
import {stripe} from "../_shared/stripe.ts";
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const u=await user(req);if(!u)return json({error:"Sign in first"},401);
 const db=admin(),{data:me}=await db.from("profiles").select("is_admin").eq("id",u.id).single();
 if(!me?.is_admin)return json({error:"Not allowed"},403);
 const b=await req.json().catch(()=>({})),log=(a:string,t:string)=>db.from("audit_log").insert({actor:u.id,action:a,target:t});
 if(b.action==="users"){
  const q=String(b.q??"").toLowerCase().replace(/[^a-z0-9_@.-]/g,"");if(q.length<3)return json({error:"Type at least 3 characters"},400);
  const{data:ps}=await db.from("profiles").select("id,handle,display_name,is_banned,created_at").or(`handle.ilike.%${q}%,display_name.ilike.%${q}%`).limit(20);
  const{data:lu}=await db.auth.admin.listUsers({page:1,perPage:1000});
  const byEmail=(lu?.users??[]).filter(x=>x.email?.toLowerCase().includes(q)).slice(0,20).map(x=>x.id);
  const missing=byEmail.filter(id=>!(ps??[]).some(p=>p.id===id));
  const{data:more}=missing.length?await db.from("profiles").select("id,handle,display_name,is_banned,created_at").in("id",missing):{data:[]};
  const out=[];for(const p of[...(ps??[]),...(more??[])]){const{data:a}=await db.auth.admin.getUserById(p.id);out.push({...p,email:a?.user?.email})}
  return json({users:out})}
 if(b.action==="code"){
  const{data:bot}=await db.from("bots").select("name,current_version_id").eq("id",b.bot_id).maybeSingle();
  if(!bot?.current_version_id)return json({error:"No code uploaded"},404);
  const{data:v}=await db.from("bot_versions").select("storage_path").eq("id",bot.current_version_id).single();
  const{data:f}=await db.storage.from("bot-code").download(v!.storage_path);if(!f)return json({error:"File missing"},404);
  await log("view code",String(b.bot_id));return json({name:bot.name,code:(await f.text()).slice(0,100000)})}
 if(b.action==="refund"){
  const pi=String(b.payment_intent??"");if(!/^pi_\w+$/.test(pi))return json({error:"Enter a Stripe payment intent id (pi_...)"},400);
  try{const r=await stripe("refunds",{payment_intent:pi});await log("refund",pi);return json({id:r.id,status:r.status})}
  catch(e){return json({error:(e as Error).message},502)}}
 return json({error:"Unknown action"},400)});
