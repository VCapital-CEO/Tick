import {fingerprint,similarity} from "./fingerprint.ts";
const a=`def sma(values, n):
    return sum(values[-n:]) / n

def decide(candles, markets):
    out = {}
    for m in markets:
        closes = [c["c"] for c in candles[m]]
        if len(closes) < 50:
            out[m] = 0.0
        else:
            out[m] = 1.0 if sma(closes, 20) > sma(closes, 50) else 0.0
    return out
`;
const renamed=a.replaceAll("sma","avg").replaceAll("values","xs").replaceAll("closes","px").replaceAll("out","res").replaceAll(" m "," mk ").replaceAll("[m]","[mk]").replaceAll("candles","bars")+"\n# added comment\n";
const other=`import relay_ta as ta
def decide(candles, markets, state):
    out = {}
    for m in markets:
        v = ta.closes(candles[m])
        r = ta.rsi(v, 14)
        holding = state.get(m, 0.0)
        if r is not None:
            if r < 30:
                holding = 1.0
            elif r > 60:
                holding = 0.0
        state[m] = holding
        out[m] = holding
    return out
`;
Deno.test("renamed copies look the same, different bots do not",()=>{
 const fa=fingerprint(a)!,fr=fingerprint(renamed)!,fo=fingerprint(other)!;
 const s1=similarity(fa,fr),s2=similarity(fa,fo);
 console.log("renamed copy:",s1.toFixed(2),"different bot:",s2.toFixed(2));
 if(s1<0.8)throw new Error("renamed copy not detected: "+s1);
 if(s2>0.5)throw new Error("different bot flagged: "+s2)});
Deno.test("tiny files are not fingerprinted",()=>{if(fingerprint("def decide(c,m):\n    return {}\n")!==null)throw new Error("should skip")});
