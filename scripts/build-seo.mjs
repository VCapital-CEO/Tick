// Generates sitemap.xml, robots.txt and static stub pages for bots and profiles.
// Usage: SUPABASE_URL=... SUPABASE_ANON_KEY=... SITE_URL=https://yoursite.web.app node scripts/build-seo.mjs
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
const {SUPABASE_URL:U,SUPABASE_ANON_KEY:K,SITE_URL:S}=process.env;
if(!U||!K||!S){console.error("Set SUPABASE_URL, SUPABASE_ANON_KEY, SITE_URL");process.exit(1)}
const get=async p=>(await fetch(`${U}/rest/v1/${p}`,{headers:{apikey:K,Authorization:`Bearer ${K}`}})).json();
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const shell=readFileSync("public/index.html","utf8");
function page(dir,url,title,desc){
  const h=shell.replace(/<title>.*?<\/title>/,`<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content=".*?">/,`<meta name="description" content="${esc(desc).slice(0,160)}"><link rel="canonical" href="${url}">`)
    .replace(/<meta property="og:title" content=".*?">/,`<meta property="og:title" content="${esc(title)}">`)
    .replace(/<meta property="og:description" content=".*?">/,`<meta property="og:description" content="${esc(desc).slice(0,200)}">`)
    .replace('<div id="view"></div>',`<div id="view"><h1>${esc(title)}</h1><p>${esc(desc)}</p></div>`);
  mkdirSync(`public/${dir}`,{recursive:true});writeFileSync(`public/${dir}/index.html`,h);
}
const bots=await get("bot_cards?select=slug,name,description,creator_handle,price_cents,billing_period");
const profs=await get("profiles?select=handle,display_name,bio");
const urls=[`${S}/`,`${S}/legal/terms`,`${S}/legal/privacy`,`${S}/legal/risk`];
for(const b of bots){const u=`${S}/bots/${b.slug}`;urls.push(u);page(`bots/${b.slug}`,u,`${b.name} by ${b.creator_handle} | Tick`,b.description||`${b.name}, a trading bot on Tick.`)}
for(const p of profs){const u=`${S}/u/${p.handle}`;urls.push(u);page(`u/${p.handle}`,u,`${p.display_name} (@${p.handle}) | Tick`,p.bio||`${p.display_name}'s bots and reviews on Tick.`)}
writeFileSync("public/sitemap.xml",`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u=>`<url><loc>${u}</loc></url>`).join("")}</urlset>`);
writeFileSync("public/robots.txt",`User-agent: *\nAllow: /\nSitemap: ${S}/sitemap.xml\n`);
console.log(`Wrote ${urls.length} URLs`);
