import {cors,json,admin,user,hex} from "../_shared/util.ts";
import {fingerprint,similarity} from "../_shared/fingerprint.ts";
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const u=await user(req);if(!u)return json({error:"Sign in first"},401);
 const{bot_id,path}=await req.json().catch(()=>({}));const db=admin();
 if(typeof path!=="string"||!path.startsWith(`${u.id}/${bot_id}/`)||!path.endsWith(".py"))return json({error:"Bad path"},400);
 const{data:bot}=await db.from("bots").select("id,creator_id").eq("id",bot_id).maybeSingle();
 if(!bot||bot.creator_id!==u.id)return json({error:"Bot not found"},404);
 const{data:act}=await db.from("verification_runs").select("id").eq("bot_id",bot_id).eq("kind","verification").in("state",["pending","running"]);
 if(act?.length)return json({error:"Wait for the current verification run to finish"},409);
 const{data:f,error}=await db.storage.from("bot-code").download(path);if(error||!f)return json({error:"File not found"},404);
 const buf=await f.arrayBuffer();if(buf.byteLength>200_000)return json({error:"File is over 200 KB"},400);
 let text:string;try{text=new TextDecoder("utf-8",{fatal:true}).decode(buf)}catch{return json({error:"This is not a text file. A bot must be a Python source file (.py)"},400)}
 if(text.includes("\u0000"))return json({error:"This is not a text file. A bot must be a Python source file (.py)"},400);
 if(!/^def\s+decide\s*\(/m.test(text))return json({error:"Bot must define a top-level function: def decide(candles, markets)"},400);
 const fp=fingerprint(text);
 const sha=hex(await crypto.subtle.digest("SHA-256",buf));
 const{data:last}=await db.from("bot_versions").select("version").eq("bot_id",bot_id).order("version",{ascending:false}).limit(1);
 const{data:v,error:e2}=await db.from("bot_versions").insert({bot_id,version:(last?.[0]?.version??0)+1,code_sha256:sha,storage_path:path,fingerprint:fp}).select("id,version").single();
 if(e2)return json({error:e2.message},500);
 if(fp){const{data:others}=await db.from("bot_versions").select("bot_id,fingerprint,bots!bot_versions_bot_id_fkey(creator_id)").neq("bot_id",bot_id).not("fingerprint","is",null).limit(3000);
  for(const o of others??[]){if((o.bots as any)?.creator_id===u.id)continue;const sim=similarity(fp,o.fingerprint as number[]);if(sim>=0.7)await db.from("code_flags").insert({bot_id,other_bot_id:o.bot_id,similarity:sim})}}
 await db.from("verification_runs").update({state:"failed",result:{reason:"New version uploaded"}}).eq("bot_id",bot_id).eq("kind","track").in("state",["pending","running"]);
 await db.from("bots").update({current_version_id:v.id,verification:"none",code_check:"pending",code_check_notes:[]}).eq("id",bot_id);
 return json({version:v.version,sha256:sha});
});