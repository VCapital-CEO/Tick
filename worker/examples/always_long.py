# Test bot: always fully long. Use it only to prove the plumbing works.
def decide(candles, markets):
    return {m: 1.0 for m in markets}
