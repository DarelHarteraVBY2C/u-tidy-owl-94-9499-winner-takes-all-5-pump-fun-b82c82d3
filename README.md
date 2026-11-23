# Launch Sniper — Pump.fun Replay Sprint

[![make.fun](https://make.fun/badge/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3.svg)](https://make.fun/bounty/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3)
[![rank](https://make.fun/badge/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3/DarelHarteraVBY2C/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3/rank.svg)](https://make.fun/bounty/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3)
[![reward](https://make.fun/badge/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3/DarelHarteraVBY2C/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3/reward.svg)](https://make.fun/bounty/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3)

A trading bot for the [Winner Takes All — $5 Pump.fun Replay Sprint](https://make.fun/bounty/u-tidy-owl-94-9499-winner-takes-all-5-pump-fun-b82c82d3) on [make.fun](https://make.fun). It trades 10 SOL of paper money on a replay of pump.fun bonding-curve data; best net PnL wins the whole pot.

## Strategy: Launch Sniper

Buy a launch in its first few slots, but only when the creator has skin in the game (a modest own buy, no creator sell), a small crowd of other wallets is already buying, and sellers have not taken over. Most launches fade, so the size is small (0.10 SOL), losers are cut at −8%, and winners are banked in two steps: half the position is sold at +15%, the rest rides toward +40% or a 200-slot time limit.

What the dev window taught us: momentum chasing after a rise loses (the rise is usually the top), deep-dip buying loses worse, and riding coins toward the 85-SOL migration loses most of the time because only a third of them ever get there. The launch sniper is the only family that comes close to break-even on the dev window — dev net PnL −0.07 SOL over 129 round trips, max drawdown 1.1%, guardrails met (93 coins with a round trip ≥ 0.01 SOL).

## Run

The entrypoint is `main.ts` (Node 22, TypeScript run as-is, zero dependencies). It speaks the `agent-fun/replay/v2` protocol on stdin/stdout through the vendored SDK shim in `vendor/makefun-bot.ts`. Fully deterministic: no clock, no randomness, no environment, no network — two executions produce byte-identical action logs.

## License

MIT. See [LICENSE](LICENSE).
