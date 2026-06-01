# Equity Trading Bot - Project Context

This document provides a comprehensive overview of the Equity Trading Bot project. It is designed to act as a complete context payload for any AI assistant to understand the system's architecture, dependencies, and core logic, particularly for extending the technical indicator rules engine.

## 1. Project Overview
**Name:** equity-bot
**Type:** Node.js backend application (ES Modules, Node >= 20.x)
**Purpose:** A personal Indian equity trading assistant that integrates with Zerodha (Kite Connect), scrapes Chartink screeners for potential stock breakouts, runs secondary technical indicator validations, and communicates entirely via a Telegram Bot interface using Natural Language Processing (NLP).

## 2. Tech Stack & Dependencies
* **Core:** Node.js (ES Modules)
* **Telegram Bot:** `grammy` (Fast, modern framework for Telegram Bot API)
* **Broker Integration:** `kiteconnect` (Official Zerodha Kite Connect SDK)
* **Scraping / Data Fetching:** `axios`, `cheerio`
* **Technical Indicators:** `technicalindicators` (Library for calculating RSI, MACD, EMA, SMA, etc.)
* **Database:** `better-sqlite3` (Synchronous, fast local SQLite database)
* **Scheduling:** `node-cron`
* **Logging:** `pino`, `pino-pretty`
* **Web Server:** `express` (For webhook postbacks)

## 3. Architecture Breakdown

The project is structured into distinct, decoupled modules under the `src/` directory:

### `src/bot/` (Telegram Interface)
*   **`bot.js`**: Initializes the GrammY bot. Includes a robust NLP intent matcher in its `message` event handler to map plain English commands (e.g., *"Add persistent to my watchlist"*, *"Connect Zerodha"*, *"Scan my portfolio"*) to specific slash-command handlers.
*   **`commands/`**: Contains modular handlers for every command (`scan.js`, `watchlist.js`, `portfolio.js`, `login.js`, etc.).
*   **`formatters.js`**: Responsible for taking raw data arrays and outputting clean, Telegram-friendly HTML strings with emojis. Contains limits and sorting rules for UI representation (e.g., capping qualified stocks to 10 in UI).

### `src/screener/` (Discovery)
*   **`chartink.js`**: Replicates a headless browser session to bypass Cloudflare/CSRF protections. Submits payload queries to Chartink (a popular Indian stock screener) to find baseline candidate stocks that meet primary momentum breakout criteria.

### `src/indicator/` (Validation Engine - The Brain)
This is the most critical component for strategy enhancement. It validates raw screener results against strict technical rules.
*   **`data-fetcher.js`**: Fetches historical OHLCV (Open, High, Low, Close, Volume) data. By default, it hits Yahoo Finance's unofficial API for NSE (`.NS`) tickers to retrieve the last 200 days of data.
*   **`rules.js`**: The configuration file that defines the technical setup. Currently uses a `WEIGHTED` logic system with a Max Score of 100.
*   **`engine.js`**: Computes the rules dynamically using the `technicalindicators` library.

### `src/kite/` (Execution & Portfolio)
*   **`client.js`**: Wrapper around `KiteConnect`. Handles fetching holdings, positions, orders, and executing trades.
*   **`auth.js`**: Manages the OAuth flow, retrieving request tokens, and saving access tokens to the SQLite database.

### `src/db/` (State Management)
*   **`database.js` / `migrations.js` / `queries.js`**: Manages a local `data/equity-bot.db` file. Stores the valid Kite Access Token, the user's Watchlist, and a daily log of alerted symbols (to prevent spamming the same stock twice in one day).

### `src/scheduler/` (Automation)
*   **`cron.js`**: Sets up recurring jobs.
    *   **Pre-Market Scan (9:05 AM)**: Scans Chartink, runs the Indicator Engine, sorts by confidence score, and sends the top 5 highest-scoring qualified stocks.
    *   **EOD Summary (3:45 PM)**: Fetches realized P&L, current open positions, and sends a wrap-up report.

## 4. The Indicator Scoring System (Deep Dive)

The bot uses a custom `WEIGHTED` confidence scoring system (Max Score: 100). The rules are defined in `src/indicator/rules.js`. 

**Key Concept: Mandatory Gatekeepers vs. Weighted Confirmations**
1.  **Mandatory Rules:** A rule flagged with `mandatory: true` acts as a gatekeeper. If a stock fails this rule, the engine will mark `passed: false` and categorize it as `Failed Mandatory`. However, the engine *preserves* the calculated score to visually indicate how close the stock was to qualifying.
2.  **Weighted Rules:** Contribute to the final `score / maxScore`.

### Current Strategy Rules
1.  **Relative Volume Breakout** (`weight: 20`, `mandatory: true`): 
    *   *Logic:* Identifies volume contraction followed by expansion. Checks if the volume was below a threshold for `quietPeriods` (e.g., 4 days), and then suddenly crosses 2x the 20-day Average Volume.
    *   *Impact:* Without volume, it fails entirely. If it passes, it adds 20 points.
2.  **Volume Spike Confirmation** (`weight: 16`, `mandatory: false`): Current volume > 1.5x average.
3.  **RSI Momentum** (`weight: 16`, `mandatory: false`): RSI(14) > 55. Rules out bearish/choppy fakeouts.
4.  **Short-Term Momentum** (`weight: 16`, `mandatory: false`): EMA(9) > EMA(10). Micro-trend alignment.
5.  **Macro Trend** (`weight: 16`, `mandatory: false`): EMA(50) > EMA(200) (Golden Cross intact).
6.  **MACD Bullish** (`weight: 16`, `mandatory: false`): MACD Line > Signal Line.

## 5. How to Enhance the Strategy (For AI Agents)

To add more rules to find winning trades, follow this workflow:

1.  **Define the Rule in `rules.js`**: Add a new object to the `rules` array. You must re-balance the weights so the sum across all rules equals 100 (or change the max score).
    ```javascript
    {
      id: 'bollinger_squeeze',
      name: 'Bollinger Band Squeeze Breakout',
      type: 'BOLLINGER_BREAKOUT', // Custom type identifier
      period: 20,
      stdDev: 2,
      mandatory: false,
      weight: 10,
      description: 'Price is breaking above the upper Bollinger Band after a squeeze'
    }
    ```
2.  **Implement the Math in `engine.js`**: In the `evaluate` method inside `engine.js`, locate the `switch (rule.type)` block and add a new case to process the math using the `technicalindicators` library or custom array logic.
    ```javascript
    case 'BOLLINGER_BREAKOUT':
      // 1. Calculate Bollinger Bands using closes
      // 2. Determine if the conditions are met
      // 3. Set rulePassed = true/false and calculate currentValue
      break;
    ```
3.  **Update Weights**: Ensure the weights in `rules.js` still sum to 100 so the UI accurately displays `[X/100]` confidence scores.

## 6. Execution Flow Example (`/scan` command)
1. User types "Scan" in Telegram.
2. `bot.js` NLP router catches it and forwards it to `scanCommand()` in `src/bot/commands/scan.js`.
3. Calls `screener.scanAll()` (Chartink scrape -> returns ~100 raw tickers).
4. Limits to top 50 stocks by simple % change (momentum) to save API calls.
5. Passes the 50 stocks into `indicatorEngine.evaluate()`.
6. Yahoo Finance API is hit for OHLCV data for each stock.
7. Technical rules are evaluated; scores are assigned.
8. Arrays are split into `qualifying` (Mandatory rules passed) and `partial` (Failed Mandatory).
9. Sliced for UI limits (Max 10 Qualified, Max 25 Total) and formatted by `formatters.js`.
10. Final HTML block is sent to Telegram with Inline Keyboard buttons for checking individual stocks.
