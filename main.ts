// Launch Sniper for the pump.fun replay sprint.
//
// Idea: buy a launch in its first few slots, but only when the creator has
// skin in the game (a modest own buy, not a huge one, and no creator sell),
// a small crowd of other wallets is already buying (one or two, not a
// bundled mob), and sellers have not taken over yet. Most launches fade, so
// the size is small (0.10 SOL), losers are cut at -8%, and winners are
// banked in two steps: half the position is sold at +15%, the rest rides
// toward +40% or a 200-slot time limit, whichever comes first.
//
// Why this shape: across the dev window, momentum chasing after a rise
// loses (the rise is usually the top), deep-dip buying loses worse, and
// riding coins toward the 85-SOL migration loses most of the time because
// only a third of them ever get there. The launch sniper is the only family
// that comes close to break-even on the dev window: its picks have a small
// positive gross edge and the job is to keep the fee drag (about 1.25% per
// side plus a fixed tx fee) from eating it. That is why the filters are
// tight, the stake is small, and the exits are fast.
//
// Guardrails: at least 20 coins need a round trip of >= 0.01 SOL. The bot
// cycles through launches with at most 5 open positions, so over a 6-hour
// window it completes far more than 20 round trips. Max drawdown stays
// small because no single position is bigger than 0.10 SOL and losers are
// cut at -8%.
//
// Deterministic by construction: no clock, no randomness, no environment,
// iteration only over insertion-ordered maps fed by the batch stream. Two
// runs therefore produce byte-identical action logs.

import {
  LAMPORTS_PER_SOL,
  runBot,
  type Batch,
  type BotState,
  type OrderInput,
  type Pubkey,
} from './vendor/makefun-bot.ts';

// ---- tunables (SOL as a float, slots as counts) ----
const MAX_AGE_SLOTS = 3; // oldest age (slots since create) for a first buy
const STAKE_SOL = 0.1; // SOL per launch
const MIN_BUY_SOL = 0.005; // smallest buy worth the tx fee
const MIN_REAL_SOL = 0.3; // real SOL reserve at entry, lower bound
const MAX_REAL_SOL = 30; // real SOL reserve at entry, upper bound
const MIN_DEV_BUY_SOL = 0.05; // creator's own buys must reach this
const MAX_DEV_BUY_SOL = 1.0; // ... but not exceed this (a big dev buy is a dump setup)
const MIN_BUYERS = 1; // distinct non-creator buyers before entry
const MAX_BUYERS = 3; // ... at most this many (a bundled launch is a dump in waiting)
const MAX_SELL_RATIO = 1.0; // lamports sold / lamports bought, at most
const BUY_SLIPPAGE_BPS = 10000;
const SELL_SLIPPAGE_BPS = 10000;
const PARTIAL_TP = 0.15; // sell half the position at +15%
const PARTIAL_SHARE = 0.5; // share of the position sold at the partial take-profit
const TAKE_PROFIT = 0.4; // sell the rest at +40% vs cost
const STOP_LOSS = 0.08; // sell all at -8% vs cost
const MAX_HOLD_SLOTS = 200; // sell after this many slots held

const SOL = Number(LAMPORTS_PER_SOL);

interface Launch {
  createdSlot: number;
  creator: Pubkey;
  devBuySol: number;
  devSold: boolean;
  buyers: Set<string>;
  buySol: number;
  sellSol: number;
  entered: boolean;
  partialDone: boolean;
}

interface Held {
  costSol: number; // SOL spent on the tokens still held, fees included
  buySlot: number; // slot the position was opened (first fill seen)
}

const launches = new Map<Pubkey, Launch>();
const held = new Map<Pubkey, Held>();

function priceOf(curve: { virtual_quote_reserves: bigint; virtual_token_reserves: bigint }): number {
  const tokens = Number(curve.virtual_token_reserves);
  if (tokens <= 0) return 0;
  return Number(curve.virtual_quote_reserves) / tokens;
}

function maybeEnter(state: BotState, batch: Batch, orders: OrderInput[]): void {
  const { caps } = state.hello;
  const txFeeSol = Number(state.txFeeLamports()) / SOL;
  let freeSol = Number(state.freeCashLamports()) / SOL;
  let slots = caps.max_open_positions - state.committedPositionCount();
  if (slots <= 0) return;
  for (const e of batch.events) {
    if (orders.length >= caps.max_orders_per_batch) return;
    if (e.event !== 'TradeEvent') continue;
    const l = launches.get(e.mint);
    if (l === undefined || l.entered) continue;
    const age = batch.slot - l.createdSlot;
    if (age < 0 || age > MAX_AGE_SLOTS) continue;
    if (l.buyers.size < MIN_BUYERS || l.buyers.size > MAX_BUYERS) continue;
    if (l.devBuySol < MIN_DEV_BUY_SOL || l.devBuySol > MAX_DEV_BUY_SOL) continue;
    if (l.devSold) continue;
    if (l.buySol > 0 && l.sellSol / l.buySol > MAX_SELL_RATIO) continue;
    const curve = state.curves.get(e.mint);
    if (curve === undefined || curve.complete) continue;
    const realSol = Number(curve.real_quote_reserves) / SOL;
    if (realSol < MIN_REAL_SOL || realSol > MAX_REAL_SOL) continue;
    const capSol = Number(state.maxBuyLamports(e.mint)) / SOL;
    if (capSol < MIN_BUY_SOL) continue;
    const amountSol = Math.min(STAKE_SOL, capSol);
    if (amountSol + txFeeSol > freeSol) continue;
    l.entered = true;
    slots -= 1;
    freeSol -= amountSol + txFeeSol;
    orders.push({
      side: 'buy',
      mint: e.mint,
      quote_lamports: BigInt(Math.floor(amountSol * SOL)),
      max_slippage_bps: BUY_SLIPPAGE_BPS,
    });
  }
}

function maybeExit(state: BotState, batch: Batch, orders: OrderInput[]): void {
  for (const [mint, pos] of state.positions) {
    if (orders.length >= state.hello.caps.max_orders_per_batch) return;
    const curve = state.curves.get(mint);
    if (curve === undefined || curve.complete) continue;
    const price = priceOf(curve);
    if (price <= 0) continue;
    const tokens = Number(pos.token_amount);
    const valueSol = (tokens * price) / SOL;
    const h = held.get(mint);
    if (h === undefined) {
      held.set(mint, { costSol: valueSol, buySlot: batch.slot });
      continue;
    }
    const costSol = Number(pos.cost_lamports) / SOL;
    const ret = costSol > 0 ? valueSol / costSol - 1 : 0;
    const launch = launches.get(mint);
    // Bank half the position the first time it reaches the partial target.
    if (launch !== undefined && !launch.partialDone && ret >= PARTIAL_TP) {
      launch.partialDone = true;
      const sellTokens = BigInt(Math.floor(tokens * PARTIAL_SHARE));
      if (sellTokens > 0n) {
        orders.push({
          side: 'sell',
          mint,
          token_amount: sellTokens,
          max_slippage_bps: SELL_SLIPPAGE_BPS,
        });
        continue;
      }
    }
    const heldSlots = batch.slot - h.buySlot;
    const exit =
      ret >= TAKE_PROFIT ||
      ret <= -STOP_LOSS ||
      heldSlots >= MAX_HOLD_SLOTS ||
      (launch !== undefined && launch.devSold);
    if (!exit) continue;
    held.delete(mint);
    orders.push({
      side: 'sell',
      mint,
      token_amount: pos.token_amount,
      max_slippage_bps: SELL_SLIPPAGE_BPS,
    });
  }
}

await runBot({
  onBatch(state, batch) {
    // Fold this batch's trades into the per-launch books.
    for (const e of batch.events) {
      if (e.event === 'CreateEvent') {
        if (!launches.has(e.mint)) {
          launches.set(e.mint, {
            createdSlot: e.slot,
            creator: e.creator,
            devBuySol: 0,
            devSold: false,
            buyers: new Set(),
            buySol: 0,
            sellSol: 0,
            entered: false,
            partialDone: false,
          });
        }
      } else if (e.event === 'TradeEvent') {
        let l = launches.get(e.mint);
        if (l === undefined) {
          l = {
            createdSlot: e.slot,
            creator: e.user,
            devBuySol: 0,
            devSold: false,
            buyers: new Set(),
            buySol: 0,
            sellSol: 0,
            entered: false,
            partialDone: false,
          };
          launches.set(e.mint, l);
        }
        const sol = Number(e.sol_amount) / SOL;
        if (e.is_buy) {
          l.buySol += sol;
          if (e.user === l.creator) l.devBuySol += sol;
          else l.buyers.add(e.user);
        } else {
          l.sellSol += sol;
          if (e.user === l.creator) l.devSold = true;
        }
      } else if (e.event === 'CompleteEvent') {
        held.delete(e.mint);
      }
    }
    // Positions the harness closed (complete / flatten) disappear from
    // state.positions; drop their held records too.
    for (const mint of [...held.keys()]) {
      if (!state.positions.has(mint)) held.delete(mint);
    }
    const orders: OrderInput[] = [];
    maybeExit(state, batch, orders);
    maybeEnter(state, batch, orders);
    return orders;
  },
});
