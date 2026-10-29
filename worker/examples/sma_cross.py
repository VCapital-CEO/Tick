# Example bot: long when the 20-hour average is above the 50-hour average, otherwise flat.
# Contract: decide(candles, markets) -> {market: target exposure from -1 to 1}
# candles[market] is a list of {"t","o","h","l","c","v"} dicts, oldest first. Standard library only.
def sma(values, n):
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
