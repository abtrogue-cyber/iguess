# Conviction — portfolio performance tracker

A single, self-contained web app (`index.html`) for a concentrated multi-currency portfolio held at DEGIRO and Interactive Brokers. Open the file in a browser; everything runs locally and is stored in `localStorage`. Chart.js (jsDelivr, SRI-pinned) and the fonts (Google Fonts) load from a CDN. If you turn on live prices, quotes come from the provider you choose.

## What it does

- **Import** DEGIRO *Transactions* and *Account statement* CSVs (DE/EN/NL headers, German decimals), IBKR *Activity Statement*, *Transaction History* and *Flex Query* CSVs, and any other CSV through a manual column mapper. Re-imports are de-duplicated. The same security from both brokers is linked by ISIN, broker symbol or name, and you can merge instruments by hand.
- **Manual entry** of trades (buy/sell, split, transfer in/out, options via OCC symbol) and cash movements (deposits, withdrawals, dividends with withholding tax, interest, fees).
- **Live prices (optional)**: paste a free API key from [Finnhub](https://finnhub.io/register) or [Twelve Data](https://twelvedata.com/register) under *Data → Prices*.
  - Quotes are fetched each time the app opens, then every minute (Twelve Data: every five) while the US market is open. Each holding keeps one price per day, so its history fills in as you use the app.
  - Exchange rates come from the ECB via [Frankfurter](https://frankfurter.dev), no key needed.
  - The free plans cover US-listed shares and ETFs. Give a holding listed elsewhere its provider symbol, such as a US OTC listing; a quote in another currency is converted at the ECB rate.
  - Options and warrants keep manual prices.
  - The key stays in your browser and is never part of the data or backups.
- **Prices you control**: an "update prices" table, a paste box (`TICKER price` lines or JSON), and CSV price/FX/benchmark history. Nothing is invented: without live prices, a holding is valued at the last price you entered or traded at.
- **Metrics**: total value, net invested, absolute/simple return, TWR and XIRR, FIFO realised/unrealised P&L, price vs. currency effect, dividends/fees/tax as separate drags, volatility, max drawdown, Sharpe, Sortino, beta, concentration (top-3, effective N, threshold warning), and comparison with three benchmarks. Every formula is in an ⓘ tooltip.
- **Views**: Dashboard, Positions, Position detail, Allocation (position/theme tag/sector/currency/country/broker), Performance (heatmap, drawdown, rolling 12M), Closed positions (win rate, holding period, best/worst, per-year table), Activity, Data & prices, Checks, Settings.
- **Backup**: JSON export and restore, plus a trades CSV.

## Design

An "instrument panel" look rather than a dashboard template:

- **Type:** Archivo, a variable-width grotesk: expanded for titles, condensed for the big figures. Geist Mono is used for every figure, label and table column, so all numbers are tabular.
- **Colour:** near-black with a faint dot grid, film grain and slow ambient light. The light behind the hero tints green or red with the day's move. Cyan is the single accent (deep cyan on the "paper" light theme). Green and red appear only for gains and losses; the colour-blind option swaps them for blue and orange.
- **Layout:** seamless hairline panel grids with HUD corner brackets, a cursor spotlight on panels and staggered load-in.
- **Interaction:**
  - Hover or drag the hero chart to scrub through time; the net asset value and P&L update to that date.
  - Charts have TradingView-style crosshairs with axis tags and direct end labels.
  - The portfolio and exposure heat-maps are squarified treemaps, coloured by P&L % or the last price move.
  - Odometer digits roll in on load.
  - A ticker tape shows the latest stored prices.
  - A command palette (Ctrl/⌘ K or `/`) jumps to positions, views and actions.
  - On phones a bottom tab bar replaces the top navigation.

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
| `src/engine-live.js` | live prices: symbol choice, quote parsing, currency translation, storage, US market hours |
| `src/engine-demo.js` | deterministic synthetic demo portfolio |
| `src/engine-tests.js` | hand-calculated verification cases (also shown on the in-app *Checks* page) |
| `src/app-*.js`, `src/styles.css` | UI (`app-live.js`: fetching quotes and ECB rates, the Live prices card) |

## Conventions

- FX rates are units of foreign currency per 1 EUR (USD 1.16), as DEGIRO and the ECB quote them.
- Daily TWR: `r_t = (V_t − V_{t−1} − F_t) / (V_{t−1} + max(F_t, 0))`. Inflows count at the start of the day and outflows at the end.
- Cost basis is FIFO across brokers and includes purchase fees. A single sale can be marked LIFO (newest lots first) in the transaction form, as IBKR lets you choose per sale; it moves P&L between realised and unrealised, not the total. A transfer between brokers is not a sale: the original lots and dates carry over. A transfer-in with no matching transfer-out is treated as a deposit of securities.
- A security traded on several listings (NASDAQ in USD, Tradegate in EUR) is one instrument. It is priced in the currency of its most recent trade, and trade prices from the other listing are translated through EUR.

### Import rules

- **DEGIRO Transactions:** a 00:00 row without an order ID is read as a broker transfer. Bank-issued warrants and certificates are the exception: for them such a row is the payout at expiry or knock-out, so it is a sale. Warrants get their WKN as ticker.
- **DEGIRO Account statement:**
  - Not imported, because they are cash sweeps or rows already in the Transactions file: "Processed Flatex Withdrawal" reservations and releases, certificate payouts ("AUSZAHLUNG ZERTIFIKAT: Verkauf …") and trade cash.
  - Foreign-currency dividends, taxes and fees are converted at the rate of the conversion that DEGIRO books a day or two later.
- **IBKR Transaction History:**
  - Trading costs are net minus gross amount, so they include stamp duties and exchange fees on top of the commission.
  - An FX conversion is split into its commission (a fee) and its FX result.
- **Limitation:** cash is kept in EUR per broker. If dollars from a sale are held and reinvested without being converted, the gain or loss on those dollars is not visible. IBKR books it as "FX Translations P&L"; for DEGIRO, add it as an FX adjustment.
