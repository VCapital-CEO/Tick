import {BINANCE as BASE} from "./config.js";
const HOUR=3600e3;
export async function syncMarkets(db,minVol){
 const start=new Date().toISOString();
 const[info,tick]=await Promise.all([fetch(`${BASE}/api/v3/exchangeInfo?permissions=SPOT`).then(r=>r.json()),fetch(`${BASE}/api/v3/ticker/24hr`).then(r=>r.json())]);
 if(!info.symbols||!Array.isArray(tick))throw new Error("unexpected exchange response");
 const vol=new Map(tick.map(t=>[t.symbol,+t.quoteVolume]));
 const rows=info.symbols.filter(s=>s.quoteAsset==="USDT"&&s.status==="TRADING"&&s.isSpotTradingAllowed).map(s=>{
  const f=s.filters,lot=f.find(x=>x.filterType==="LOT_SIZE"),n=f.find(x=>x.filterType==="NOTIONAL")||f.find(x=>x.filterType==="MIN_NOTIONAL")||{},v=vol.get(s.symbol)||0;
  return{symbol:`${s.baseAsset}/${s.quoteAsset}`,base:s.baseAsset,quote:s.quoteAsset,step_size:+lot?.stepSize||null,min_notional:+n.minNotional||null,quote_volume_24h:v,tradable:v>=minVol,updated_at:new Date().toISOString()}});
 for(let i=0;i<rows.length;i+=500){const{error}=await db.from("markets").upsert(rows.slice(i,i+500));if(error)throw error}
 await db.from("markets").update({tradable:false}).lt("updated_at",start);
 return rows.length}
export async function loadMarkets(db,SYM,VOL){
 const{data,error}=await db.from("markets").select("symbol,quote_volume_24h").eq("tradable",true).limit(1000);
 if(error)throw error;
 for(const k of Object.keys(SYM))delete SYM[k];for(const k of Object.keys(VOL))delete VOL[k];
 for(const m of data){SYM[m.symbol]=m.symbol.replace("/","");VOL[m.symbol]=+m.quote_volume_24h}}
export const SIX_HOURS=6*HOUR;
