import sys, json, inspect, importlib.util
_out = sys.stdout
sys.stdout = sys.stderr  # anything a bot prints must not corrupt the JSON result
spec = importlib.util.spec_from_file_location("bot", "/bot/bot.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
inp = json.load(sys.stdin)
state = inp.get("state") or {}
try:
    wants_state = len(inspect.signature(mod.decide).parameters) >= 3
except Exception:
    wants_state = False

def call(candles, markets):
    return mod.decide(candles, markets, state) if wants_state else mod.decide(candles, markets)

def clamp(out, markets):
    return {k: max(-1.0, min(1.0, float(v))) for k, v in out.items() if k in markets}

if "start" in inp:  # backtest mode: one decision per hourly step
    n = min(len(c) for c in inp["candles"].values())
    series = []
    for i in range(inp["start"], n):
        w = {m: c[max(0, i - 499):i + 1] for m, c in inp["candles"].items()}
        series.append(clamp(call(w, inp["markets"]), inp["markets"]))
    print(json.dumps({"series": series}), file=_out)
    sys.exit(0)
out = call(inp["candles"], inp["markets"])
print(json.dumps({"targets": clamp(out, inp["markets"]), "state": state}, default=str), file=_out)