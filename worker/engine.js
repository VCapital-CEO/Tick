// Pure paper-trading maths, shared by the verification worker and the backtester.
export const CAPITAL=10000,FEE=0.001,SLIP=0.0005,MIN_TRADE=0.01;

// Target exposure in [-1,1] per market, split evenly across markets. VOL = 24h quote volume per market.
export function step(st,prices,targets,VOL={}){
 const ms=Object.keys(prices),fills=[];
 const eq=()=>st.cash+ms.reduce((a,m)=>a+(st.pos[m]?.qty??0)*prices[m],0),E=eq();
 for(const m of ms){
  const px=prices[m],p=(st.pos[m]??={qty:0,avg:0}),e=Math.max(-1,Math.min(1,+targets[m]||0));
  const d=e*E/ms.length/px-p.qty;if(Math.abs(d*px)<MIN_TRADE*E)continue;
  const q=Math.abs(d),sl=Math.min(0.05,SLIP+0.25*q*px/(VOL[m]||1e6)),fp=px*(1+(d>0?sl:-sl)),fee=q*fp*FEE;
  let realized=null;
  if(p.qty!==0&&Math.sign(p.qty)!==Math.sign(d)){const c=Math.min(q,Math.abs(p.qty));realized=(fp-p.avg)*c*Math.sign(p.qty)-fee*(c/q)}
  const nq=p.qty+d;
  if(p.qty===0||Math.sign(p.qty)===Math.sign(d))p.avg=(Math.abs(p.qty)*p.avg+q*fp)/(Math.abs(p.qty)+q);
  else if(nq!==0&&Math.sign(nq)!==Math.sign(p.qty))p.avg=fp;
  p.qty=nq;st.cash-=d*fp+fee;
  fills.push({market:m,side:d>0?"buy":"sell",qty:q,price:fp,fee,realized_pnl:realized})}
 return{fills,equity:eq()}}

export function metrics(eq,fills){
 const e=eq.map(x=>+x.equity);let pk=e[0],dd=0;const r=[];
 e.forEach((v,i)=>{pk=Math.max(pk,v);dd=Math.max(dd,(pk-v)/pk);if(i)r.push(v/e[i-1]-1)});
 const n=r.length||1,m=r.reduce((a,b)=>a+b,0)/n,sd=Math.sqrt(r.reduce((a,b)=>a+(b-m)**2,0)/n);
 const cl=fills.filter(f=>f.realized_pnl!=null);
 return{ret:(e.at(-1)/e[0]-1)*100,dd:dd*100,sharpe:sd?m/sd*Math.sqrt(24*365):0,win:cl.length?100*cl.filter(f=>f.realized_pnl>0).length/cl.length:null,trades:fills.length}}
