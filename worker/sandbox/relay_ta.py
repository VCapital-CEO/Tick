"""Small indicator helpers available to bots: import relay_ta"""
def closes(candles): return [c["c"] for c in candles]
def sma(v, n): return sum(v[-n:]) / n if len(v) >= n else None
def ema(v, n):
    if len(v) < n: return None
    k, e = 2 / (n + 1), sum(v[:n]) / n
    for x in v[n:]: e = x * k + e * (1 - k)
    return e
def rsi(v, n=14):
    if len(v) <= n: return None
    g = l = 0.0
    for i in range(1, n + 1):
        d = v[i] - v[i - 1]; g += max(d, 0); l += max(-d, 0)
    g, l = g / n, l / n
    for i in range(n + 1, len(v)):
        d = v[i] - v[i - 1]; g = (g * (n - 1) + max(d, 0)) / n; l = (l * (n - 1) + max(-d, 0)) / n
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)
def atr(candles, n=14):
    if len(candles) <= n: return None
    tr = [max(c["h"] - c["l"], abs(c["h"] - p["c"]), abs(c["l"] - p["c"])) for p, c in zip(candles, candles[1:])]
    return sum(tr[-n:]) / n
def bollinger(v, n=20, k=2.0):
    if len(v) < n: return None
    m = sum(v[-n:]) / n; sd = (sum((x - m) ** 2 for x in v[-n:]) / n) ** 0.5
    return m - k * sd, m, m + k * sd
