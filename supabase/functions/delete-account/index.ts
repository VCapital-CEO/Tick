import {cors,json,admin,user} from "../_shared/util.ts";
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const u=await user(req);if(!u)return json({error:"Sign in first"},401);
 const db=admin();
 const{data:live}=await db.from("rentals").select("id").eq("renter_id",u.id).or("live.eq.true");
 if(live?.length)return json({error:"Stop live trading and wait for positions to be sold first"},409);
 const{error}=await db.auth.admin.deleteUser(u.id);
 if(error)return json({error:error.message},500);
 return json({deleted:true});
});
