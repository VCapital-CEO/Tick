// Renaming-proof code fingerprint: normalise tokens, hash 5-gram shingles, keep a 32-value MinHash.
const KW=new Set(["def","return","if","else","elif","for","in","while","import","from","and","or","not","None","True","False","len","range","sum","min","max","abs","float","int","lambda","continue","break","pass","is","as","try","except"]);
const fnv=(s:string)=>{let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return h>>>0};
export function fingerprint(src:string):number[]|null{
 const clean=src.replace(/#.*$/gm,"").replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|"[^"\n]*"|'[^'\n]*'/g,"S");
 const t=(clean.match(/[A-Za-z_]\w*|\d+\.?\d*|[^\s\w]/g)??[]).map(x=>/^[A-Za-z_]/.test(x)?(KW.has(x)?x:"I"):/^\d/.test(x)?"N":x);
 if(t.length<60)return null;
 const sh:number[]=[];for(let i=0;i+5<=t.length;i++)sh.push(fnv(t.slice(i,i+5).join(" ")));
 return Array.from({length:32},(_,k)=>{let m=0xffffffff;for(const h of sh){const v=(Math.imul(h,2*k+1)^Math.imul(k+1,0x9e3779b1))>>>0;if(v<m)m=v}return m|0})}
export const similarity=(a:number[],b:number[])=>a.reduce((n,x,i)=>n+(x===b[i]?1:0),0)/a.length;
