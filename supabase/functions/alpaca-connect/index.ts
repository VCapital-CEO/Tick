import {cors,json,admin,user} from "../_shared/util.ts";
// Starts the Alpaca OAuth flow. The user approves Tick on Alpaca's own page, so Tick never sees their password or API keys.
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 const u=await user(req);if(!u)return json({error:"Sign in first"},401);
 const id=Deno.env.get("ALPACA_CLIENT_ID");if(!id)return json({error:"Alpaca connection is not set up yet"},503);
 const db=admin();
 await db.from("oauth_states").delete().lt("created_at",new Date(Date.now()-3600e3).toISOString());
 const state=crypto.randomUUID().replaceAll("-","")+crypto.randomUUID().replaceAll("-","");
 const{error}=await db.from("oauth_states").insert({state,user_id:u.id});if(error)return json({error:"Could not start"},500);
 const q=new URLSearchParams({response_type:"code",client_id:id,redirect_uri:`${Deno.env.get("SUPABASE_URL")}/functions/v1/alpaca-callback`,state,scope:"account:write trading",env:"live"});
 return json({url:`https://app.alpaca.markets/oauth/authorize?${q}`});
});