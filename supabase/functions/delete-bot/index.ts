import {cors,json,admin,user} from "../_shared/util.ts";
// Permanently deletes a bot, its records and its code files. Refused while anyone is renting it.
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const u=await user(req);if(!u)return json({error:"Sign in first"},401);
 const{bot_id}=await req.json().catch(()=>({}));const db=admin();
 const{data:bot}=await db.from("bots").select("id,creator_id").eq("id",bot_id).maybeSingle();
 if(!bot||bot.creator_id!==u.id)return json({error:"Bot not found"},404);
 const{count}=await db.from("rentals").select("id",{count:"exact",head:true}).eq("bot_id",bot.id).eq("status","active");
 if(count)return json({error:"This bot has active renters. Delist it instead, or wait until their rentals end."},409);
 const dir=`${u.id}/${bot.id}`,{data:files}=await db.storage.from("bot-code").list(dir,{limit:1000});
 if(files?.length)await db.storage.from("bot-code").remove(files.map(f=>`${dir}/${f.name}`));
 const{error}=await db.from("bots").delete().eq("id",bot.id);
 if(error)return json({error:error.message},500);
 return json({deleted:true});
});