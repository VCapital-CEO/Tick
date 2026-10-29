# Example bot using indicators and saved state.
# decide(candles, markets, state): `state` is a dict that is saved between hourly runs (keep it small).
import relay_ta as ta

def decide(candles, markets, state):
    out = {}
    for m in markets:
        v = ta.closes(candles[m])
        r = ta.rsi(v, 14)
        holding = state.get(m, 0.0)
        if r is not None:
            if r < 30:
                holding = 1.0      # oversold: buy
            elif r > 60:
                holding = 0.0      # recovered: sell
        state[m] = holding
        out[m] = holding
    return out
