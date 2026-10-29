// Re-encrypt all saved exchange keys with a new secret. Stop the worker and functions first.
// Dry run:  OLD_KEY_SECRET=.. NEW_KEY_SECRET=.. SUPABASE_URL=.. SUPABASE_SERVICE_ROLE_KEY=.. node rotate-keys.mjs
// Apply:    add --apply, then set the new KEY_ENCRYPTION_SECRET on the worker and `supabase secrets set`, and restart.
import {createClient} from "@supabase/supabase-js";
import crypto from "node:crypto";
const{SUPABASE_URL:U,SUPABASE_SERVICE_ROLE_KEY:K,OLD_KEY_SECRET:O,NEW_KEY_SECRET:N}=process.env,apply=process.argv.includes("--apply");
if(!U||!K||!O||!N){console.error("Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OLD_KEY_SECRET, NEW_KEY_SECRET");process.exit(1)}
const ok=Buffer.from(O,"base64"),nk=Buffer.from(N,"base64");
if(ok.length!==32||nk.length!==32){console.error("Secrets must be 32 bytes, base64");process.exit(1)}
const dec=b=>{const r=Buffer.from(b,"base64"),d=crypto.createDecipheriv("aes-256-gcm",ok,r.subarray(0,12));d.setAuthTag(r.subarray(r.length-16));return Buffer.concat([d.update(r.subarray(12,r.length-16)),d.final()]).toString()};
const enc=t=>{const iv=crypto.randomBytes(12),c=crypto.createCipheriv("aes-256-gcm",nk,iv),ct=Buffer.concat([c.update(t,"utf8"),c.final()]);return Buffer.concat([iv,ct,c.getAuthTag()]).toString("base64")};
const db=createClient(U,K,{auth:{persistSession:false}}),{data,error}=await db.from("exchange_connections").select("id,api_key_enc,api_secret_enc");
if(error)throw error;
const next=data.map(r=>({id:r.id,api_key_enc:enc(dec(r.api_key_enc)),api_secret_enc:enc(dec(r.api_secret_enc))}));  // throws if the old secret is wrong
console.log(`${next.length} keys decrypted and re-encrypted in memory.`);
if(!apply){console.log("Dry run only. Add --apply to write.");process.exit(0)}
for(const r of next){const{error:e}=await db.from("exchange_connections").update({api_key_enc:r.api_key_enc,api_secret_enc:r.api_secret_enc}).eq("id",r.id);if(e)throw e}
console.log("Done. Now switch every service to NEW_KEY_SECRET.");
