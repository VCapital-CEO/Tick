// Rough read-load test of the public marketplace endpoint. No dependencies.
// SUPABASE_URL=.. SUPABASE_ANON_KEY=.. node loadtest.mjs [requests=200] [concurrency=20]
const U=process.env.SUPABASE_URL,K=process.env.SUPABASE_ANON_KEY,N=+process.argv[2]||200,C=+process.argv[3]||20;
if(!U||!K){console.error("Set SUPABASE_URL and SUPABASE_ANON_KEY");process.exit(1)}
const lat=[];let errors=0,next=0;
async function worker(){while(next++<N){const t=performance.now();
 try{const r=await fetch(`${U}/rest/v1/bot_cards?select=*&limit=24&order=created_at.desc`,{headers:{apikey:K,Authorization:`Bearer ${K}`}});if(!r.ok)errors++;await r.arrayBuffer()}catch{errors++}
 lat.push(performance.now()-t)}}
const t0=performance.now();await Promise.all(Array.from({length:C},worker));
lat.sort((a,b)=>a-b);const p=q=>lat[Math.min(lat.length-1,Math.floor(lat.length*q))].toFixed(0);
console.log(`${N} requests, ${C} at a time, ${((performance.now()-t0)/1000).toFixed(1)}s total: p50 ${p(.5)}ms, p95 ${p(.95)}ms, max ${lat.at(-1).toFixed(0)}ms, errors ${errors}`);
