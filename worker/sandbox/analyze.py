"""Static code check for an uploaded bot. Parses the file with ast and NEVER executes it.
Reads /bot/bot.py, prints {"findings":[{"id","level","msg","line"}],"metrics":{...}} as JSON.
Levels: block (cannot be verified), warn (shown to creator and renters), info."""
import ast, json, math, os, sys
from collections import Counter

ALLOWED = {"math", "statistics", "collections", "itertools", "functools", "heapq", "bisect", "decimal", "fractions",
           "dataclasses", "typing", "enum", "operator", "numpy", "pandas", "relay_ta", "random", "datetime", "copy", "__future__"}
BANNED_CALLS = {"exec", "eval", "compile", "__import__", "open", "input", "breakpoint", "globals", "locals", "vars",
                "getattr", "setattr", "delattr", "memoryview", "exit", "quit", "help"}
BANNED_ATTRS = {"__class__", "__subclasses__", "__globals__", "__builtins__", "__dict__", "__code__", "__mro__",
                "__bases__", "__import__", "__loader__", "__spec__", "__getattribute__", "__reduce__", "__closure__", "f_globals", "gi_frame"}
CLOCK_ATTRS = {"now", "today", "utcnow", "fromtimestamp", "utcfromtimestamp"}
out = []

def add(i, level, msg, line=None):
    out.append({"id": i, "level": level, "msg": msg, "line": line})

def entropy(s):
    c = Counter(s); n = len(s)
    return -sum(v / n * math.log2(v / n) for v in c.values())

def main():
    try:
        raw = open(os.environ.get("BOT_PATH", "/bot/bot.py"), "rb").read()
    except Exception:
        add("read", "block", "Could not read the file"); return {}
    if len(raw) > 200_000: add("size", "block", "File is over 200 KB")
    if b"\x00" in raw: add("binary", "block", "File contains null bytes")
    try:
        src = raw.decode("utf-8")
    except UnicodeDecodeError:
        add("encoding", "block", "File is not valid UTF-8"); return {}
    try:
        tree = ast.parse(src)
    except SyntaxError as e:
        add("syntax", "block", f"Syntax error: {e.msg}", e.lineno); return {}
    except (RecursionError, MemoryError, ValueError):
        add("syntax", "block", "File could not be parsed"); return {}

    # Contract: a top-level decide(candles, markets[, state])
    fn = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "decide"]
    if not fn:
        add("contract", "block", "No top-level function decide(candles, markets) found")
    else:
        a = fn[0].args
        pos = len(a.posonlyargs) + len(a.args)
        required = pos - len(a.defaults)
        if a.vararg is None and not (2 <= pos <= 3) or required > 3:
            add("contract", "block", "decide must take (candles, markets) or (candles, markets, state)", fn[0].lineno)
    if any(isinstance(n, ast.AsyncFunctionDef) and n.name == "decide" for n in tree.body):
        add("contract", "block", "decide must not be async")

    uses_candles = False
    nums = 0; ts_like = 0; big_lists = 0; branches = 0; funcs = 0
    for n in ast.walk(tree):
        ln = getattr(n, "lineno", None)
        if isinstance(n, ast.Import):
            for a in n.names:
                r = a.name.split(".")[0]
                if r not in ALLOWED: add("import", "block", f"Import '{a.name}' is not allowed (network, files, processes and the clock are off limits)", ln)
        elif isinstance(n, ast.ImportFrom):
            r = (n.module or "").split(".")[0]
            if n.level or r not in ALLOWED: add("import", "block", f"Import from '{n.module or '.'}' is not allowed", ln)
        elif isinstance(n, ast.Call):
            f = n.func
            if isinstance(f, ast.Name) and f.id in BANNED_CALLS:
                add("call", "block", f"Call to {f.id}() is not allowed", ln)
            if isinstance(f, ast.Attribute) and f.attr in CLOCK_ATTRS:
                add("clock", "warn", "Reads the system clock; decisions should depend only on the candles it is given", ln)
            if isinstance(f, ast.Name) and f.id == "print":
                add("print", "info", "print() output is discarded", ln)
        elif isinstance(n, ast.Attribute):
            if n.attr in BANNED_ATTRS or (n.attr.startswith("__") and n.attr.endswith("__") and n.attr not in ("__init__", "__name__", "__len__", "__repr__", "__str__", "__eq__", "__lt__", "__hash__")):
                add("dunder", "block", f"Access to '{n.attr}' is not allowed", ln)
        elif isinstance(n, ast.Name):
            if n.id in ("__builtins__", "__import__", "__loader__", "__spec__"): add("dunder", "block", f"Use of '{n.id}' is not allowed", ln)
            if n.id == "candles": uses_candles = True
        elif isinstance(n, (ast.Global, ast.Nonlocal)):
            add("global", "block", "global/nonlocal state is not allowed: each live run starts fresh. Use the 'state' argument to keep values between runs", ln)
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
            funcs += 1
            for d in n.args.defaults + [x for x in n.args.kw_defaults if x is not None]:
                if isinstance(d, (ast.List, ast.Dict, ast.Set)):
                    add("mutable-default", "warn", "Mutable default argument can leak state between calls", ln)
        elif isinstance(n, (ast.If, ast.For, ast.While, ast.IfExp, ast.Try)):
            branches += 1
        elif isinstance(n, ast.Constant):
            v = n.value
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                nums += 1
                if 1.4e12 <= abs(v) <= 2.2e12 or 1.4e9 <= abs(v) <= 2.2e9: ts_like += 1
            elif isinstance(v, str) and len(v.strip()) >= 80 and " " not in v.strip()[:60] and entropy(v) > 4.3:
                add("payload", "block", "Long encoded-looking string: obfuscated code or data is not allowed", ln)
            elif isinstance(v, bytes) and len(v) >= 32:
                add("payload", "block", "Embedded binary data is not allowed", ln)
        elif isinstance(n, (ast.List, ast.Tuple)) and len(n.elts) >= 50 and all(isinstance(e, ast.Constant) and isinstance(e.value, (int, float)) for e in n.elts):
            big_lists += 1
            add("embedded-data", "warn", f"Embedded table of {len(n.elts)} numbers; a bot should compute from the candles it receives", ln)

    # Module-level code other than defs/imports/constants can hide behaviour that runs on import.
    for n in tree.body:
        if isinstance(n, ast.Expr) and not (isinstance(n.value, ast.Constant) and isinstance(n.value.value, str)):
            add("toplevel", "warn", "Code runs at import time outside any function", n.lineno)
        if isinstance(n, (ast.With, ast.While, ast.Try)): add("toplevel", "warn", "Control flow at module level", n.lineno)

    if ts_like >= 5: add("timestamps", "block", f"{ts_like} hard-coded timestamps: date-specific rules cannot be verified fairly", None)
    elif ts_like: add("timestamps", "warn", "Hard-coded timestamp constant found", None)
    if nums > 2000: add("embedded-data", "block", f"{nums} numeric literals: looks like embedded price data", None)
    elif nums > 400: add("embedded-data", "warn", f"{nums} numeric literals: unusually many fixed numbers", None)
    if fn and not uses_candles:
        add("no-data", "block", "decide() never reads 'candles', so it cannot respond to the market. A trading bot has to use market data", fn[0].lineno)
    # One finding per (id,line) is enough.
    seen = set(); dedup = []
    for f in out:
        k = (f["id"], f["line"], f["msg"])
        if k not in seen: seen.add(k); dedup.append(f)
    out[:] = dedup[:60]
    return {"lines": src.count("\n") + 1, "functions": funcs, "branches": branches, "numeric_literals": nums, "bytes": len(raw)}

try:
    m = main()
except Exception as e:  # analyser bug must not look like a pass
    out.append({"id": "analyser", "level": "block", "msg": "Static analysis failed: " + type(e).__name__, "line": None}); m = {}
print(json.dumps({"findings": out, "metrics": m}))  