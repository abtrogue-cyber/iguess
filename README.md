# Conviction — portfolio performance tracker

A single, self-contained web app (`index.html`) for a concentrated multi-currency portfolio held at DEGIRO and Interactive Brokers. Open the file in a browser; everything runs locally and is stored in `localStorage`. Only Chart.js (jsDelivr, SRI-pinned) and the Inter font (Google Fonts) are loaded from a CDN.

## What it does

- **Import** DEGIRO *Transactions* and *Account statement* CSVs (DE/EN/NL headers, German decimals), IBKR *Activity Statement*, *Transaction History* and *Flex Query* CSVs, and any other CSV through a manual column mapper. Re-imports are de-duplicated. The same security from both brokers is linked by ISIN, broker symbol or name, and you can merge instruments by hand.
- **Manual entry** of trades (buy/sell, split, transfer in/out, options via OCC symbol) and cash movements (deposits, withdrawals, dividends with withholding tax, interest, fees).
- **Prices you control**: an "update prices" table, a paste box (`TICKER price` lines or JSON), and CSV price/FX/benchmark history. Nothing is fetched or faked.
- **Metrics**: total value, net invested, absolute/simple return, TWR and XIRR, FIFO realised/unrealised P&L, price vs. currency effect, dividends/fees/tax as separate drags, volatility, max drawdown, Sharpe, Sortino, beta, concentration (top-3, effective N, threshold warning), and comparison with three benchmarks. Every formula is in an ⓘ tooltip.
- **Views**: Dashboard, Positions, Position detail, Allocation (position/theme tag/sector/currency/country/broker), Performance (heatmap, drawdown, rolling 12M), Closed positions (win rate, holding period, best/worst, per-year table), Activity, Data & prices, Checks, Settings.
- **Backup**: JSON export and restore, plus a trades CSV.

## Development

The source is in `src/`. `tools/build.js` inlines it into `index.html`.

```bash
node tests/run.js     # hand-calculated engine checks + importer tests
node tools/build.js   # rebuild index.html
```

| File | Contents |
|---|---|
| `src/engine-core.js` | dates, number/date parsing, CSV, XIRR, series lookup |
| `src/engine-calc.js` | FIFO, cash, daily valuation, TWR, risk, attribution |
| `src/engine-import.js` | broker importers, instrument linking, de-duplication |
| `src/engine-demo.js` | deterministic synthetic demo portfolio |
| `src/engine-tests.js` | hand-calculated verification cases (also shown on the in-app *Checks* page) |
| `src/app-*.js`, `src/styles.css` | UI |

## Conventions

- FX rates are units of foreign currency per 1 EUR (USD 1.16), as DEGIRO and the ECB quote them.
- Daily TWR: `r_t = (V_t − V_{t−1} − F_t) / (V_{t−1} + max(F_t, 0))`. Inflows count at the start of the day and outflows at the end.
- Cost basis is FIFO across brokers and includes purchase fees. A transfer between brokers is not a sale: the original lots and dates carry over. A transfer-in with no matching transfer-out is treated as a deposit of securities.
