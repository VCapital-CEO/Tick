"""Behaviour probes for an uploaded bot. Runs INSIDE the locked-down container (no network, read-only).
Feeds the bot synthetic candles and checks the things a legitimate bot must satisfy.
stdin: {"markets":[...]}   stdout: {"findings":[{"id","level","msg"}],"metrics":{...}}
Levels: block = cannot be verified, warn = shown to creator and renters, info = detail."""
import os, sys, json, time, math, random, copy, inspect, importlib.util
_out = sys.stdout
sys.stdout = sys.stderr  # bot prints must not corrupt our JSON
findings, metrics = [], {}
START = time.time(); BUDGET = 60.0

def add(i, level, msg):
    if not any(f["id"] == i and f["msg"] == msg for f in findings):
        findings.append({"id": i, "level": level, "msg": msg})

def done():
    print(json.dumps({"findings": findings, "metrics": metrics}), file=_out); sys.exit(0)

inp = json.load(sys.stdin)
MK = [m for m in inp.get("markets", [])][:3] or ["BTC/USDT"]

try:
    spec = importlib.util.spec_from_file_location("bot", os.environ.get("BOT_PATH", "/bot/bot.py"))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
except BaseException as e:
    add("load", "block", f"Bot failed to load: {type(e).__name__}: {str(e)[:120]}"); done()
if not callable(getattr(mod, "decide", None)):
    add("load", "block", "No callable decide() found"); done()
try:
    WANTS_STATE = len(inspect.signature(mod.decide).parameters) >= 3
except Exception:
    WANTS_STATE = False

# ---- synthetic markets: trend up, trend down, range, high volatility -------------------------------------------------
def series(seed, drift, vol, revert, n=700, p0=100.0):
    r = random.Random(seed); p = p0; mu = p0; out = []; t0 = 1_700_000_000_000
    for i in range(n):
        o = p
        p *= math.exp(drift + vol * r.gauss(0, 1) + revert * (math.log(mu) - math.log(p)))
        h = max(o, p) * (1 + abs(r.gauss(0, vol / 3))); l = min(o, p) * (1 - abs(r.gauss(0, vol / 3)))
        out.append({"t": t0 + i * 3600_000, "o": o, "h": h, "l": l, "c": p, "v": 1000 + 500 * r.random()})
    return out
REGIMES = {"uptrend": (0.0004, 0.006, 0.0), "downtrend": (-0.0004, 0.006, 0.0), "range": (0.0, 0.006, 0.05), "volatile": (0.0, 0.02, 0.0)}
def world(regime, seed=1, scale=1.0, tshift=0):
    d, v, rv = REGIMES[regime]
    w = {}
    for k, m in enumerate(MK):
        cs = series(seed * 100 + k, d, v, rv, p0=100.0 * (k + 1))
        w[m] = [{"t": c["t"] + tshift, "o": c["o"] * scale, "h": c["h"] * scale, "l": c["l"] * scale, "c": c["c"] * scale, "v": c["v"]} for c in cs]
    return w
def window(w, i): return {m: c[max(0, i - 499):i + 1] for m, c in w.items()}

# ---- calling & validating ---------------------------------------------------------------------------------------------
lat = []
SEEDED = True
def reseed(key=0):
    random.seed(12345 + key)
    np = sys.modules.get("numpy")
    if np is not None:
        try: np.random.seed(12345 + key)
        except Exception: pass
def call(c, state=None, key=0):
    if time.time() - START > BUDGET:
        add("speed", "block", "Probes timed out: the bot is far too slow"); done()
    if SEEDED: reseed(key)
    t = time.time()
    try:
        r = mod.decide(c, MK, state if state is not None else {}) if WANTS_STATE else mod.decide(c, MK)
    except BaseException as e:
        add("crash", "block", f"decide() raised {type(e).__name__}: {str(e)[:120]}"); done()
    lat.append(time.time() - t)
    return r

def clean(r):
    if not isinstance(r, dict):
        add("output", "block", "decide() must return a dict of {market: exposure}"); done()
    res = {}
    for k, v in r.items():
        if k not in MK: add("output", "warn", f"Returned an exposure for unknown market '{k}'"); continue
        if isinstance(v, bool) or v is None:
            add("output", "block", "Exposure values must be numbers"); done()
        try: f = float(v)
        except Exception: add("output", "block", "Exposure values must be numbers"); done()
        if math.isnan(f) or math.isinf(f): add("output", "block", "Exposure value is NaN or infinite"); done()
        if abs(f) > 1: add("range", "warn", "Exposure outside -1..1 (it is clamped by the platform)")
        res[k] = max(-1.0, min(1.0, f))
    return {m: res.get(m, 0.0) for m in MK}

def run(w, step=2, **kw):
    s = []; st = {}
    for i in range(499, 700, step):
        s.append(clean(call(window(w, i), st if WANTS_STATE else None, i)))
    return s
def total(x): return sum(x.values()) / len(MK)
def differs(a, b):
    n = sum(1 for x, y in zip(a, b) if any(abs(x[m] - y[m]) > 1e-9 for m in MK))
    return n / max(1, len(a))

base = world("range")
W = window(base, 600)

# 1. smoke: short, empty-ish and full windows must not crash
for n in (1, 5, 30, 60, 500):
    call({m: c[:n] for m, c in base.items()})
    clean(call({m: c[:n] for m, c in base.items()}))

# 2. does it modify its input? (backtests reuse the same objects, so this would corrupt later decisions)
snap = json.dumps(W, sort_keys=True); call(W); clean(call(W))
if json.dumps(W, sort_keys=True) != snap: add("mutation", "block", "decide() modifies the candles it is given")

# 3. determinism
SEEDED = False
o1, o2 = clean(call(W)), clean(call(W))
SEEDED = True
deterministic = all(abs(o1[m] - o2[m]) < 1e-9 for m in MK)
if not deterministic: add("determinism", "warn", "Same input gave different output (unseeded randomness?). Results cannot be reproduced")

# 4. hidden state: live runs are separate processes, so earlier calls must not change later answers
if True:  # random draws are seeded here, so any remaining difference is hidden state
    B, A = window(base, 650), window(base, 550)
    b1 = clean(call(B, key=650)); call(A, key=550); b2 = clean(call(B, key=650))
    call(A, key=550); call(A, key=550); b3 = clean(call(B, key=650))  # offsets 2 and 5 catch any periodic hidden counter
    if any(abs(b1[m] - x[m]) > 1e-9 for x in (b2, b3) for m in MK):
        add("hidden-state", "block", "Output depends on earlier calls through hidden state. Live trading starts fresh every hour; keep values in the 'state' argument")

# 5. state must be small, plain data
if WANTS_STATE:
    st = {}
    for i in range(499, 520): call(window(base, i), st)
    try:
        if len(json.dumps(st)) > 16000: add("state", "warn", "State is over 16 KB and will not be saved")
    except Exception: add("state", "block", "State must be plain JSON data (numbers, strings, lists, dicts)")

# 6. behaviour across regimes
flips = {}; exposure = {}; allseries = {}
for name in REGIMES:
    s = run(world(name)); allseries[name] = s
    flips[name] = sum(1 for a, b in zip(s, s[1:]) if abs(total(a) - total(b)) > 0.05) / max(1, len(s) - 1)
    exposure[name] = sum(abs(total(x)) for x in s) / len(s)
metrics["flip_rate"] = {k: round(v, 3) for k, v in flips.items()}
metrics["mean_exposure"] = {k: round(v, 3) for k, v in exposure.items()}
if max(flips.values()) == 0: add("inactive", "warn", "Never changed its position on any synthetic market. A bot that rarely trades may not reach the 30-trade minimum")
if min(flips.values()) > 0.6: add("churn", "warn", "Changes position most hours; fees and slippage will probably dominate")
vals = {round(total(x), 6) for s in allseries.values() for x in s}
if len(vals) == 1: add("constant", "block", "Output never varies on any market, so the code is not responding to market data")

# 7. invariance tests: a sound technical bot should not care about absolute price level or calendar date
ref = allseries["range"]
sc = run(world("range", scale=1000.0))
d1 = differs(ref, sc)
if d1 > 0.05: add("price-levels", "warn", f"Decisions change on {d1:.0%} of steps when all prices are scaled 1000x: the bot may rely on hard-coded price levels")
sh = run(world("range", tshift=28 * 24 * 3600_000))
d2 = differs(ref, sh)
if d2 > 0.25: add("dates", "block", f"Decisions change on {d2:.0%} of steps when timestamps are moved 28 days: the bot depends on absolute dates")
elif d2 > 0.05: add("dates", "warn", f"Decisions change on {d2:.0%} of steps when timestamps are moved 28 days")
metrics["scale_diff"] = round(d1, 3); metrics["date_diff"] = round(d2, 3)

# 8. speed: a 30-day backtest is ~720 calls inside a 2-minute limit
avg = sum(lat) / len(lat); mx = max(lat)
metrics.update(calls=len(lat), avg_ms=round(avg * 1000, 2), max_ms=round(mx * 1000, 1))
if avg > 0.15: add("speed", "block", f"Too slow: {avg * 1000:.0f} ms per decision on average (limit 150 ms)")
elif avg > 0.05: add("speed", "warn", f"Slow: {avg * 1000:.0f} ms per decision")
if mx > 5: add("speed", "block", f"A single decision took {mx:.1f} s (limit 5 s)")
done()