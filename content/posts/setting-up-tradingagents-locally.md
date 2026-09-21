+++
title = "Running TradingAgents with existing AI subscriptions "
description = "How I set up Tauric TradingAgents on my MacBook with CLIProxyAPI, a local rate limiter, and a choice of cloud or local models."
tags = [ "AI", "finance", "trading", "TauricResearch" ]
date = "2026-06-07"
categories = [
"AI",
"finance"
]
slug = "setting-up-tradingagents-locally"
url = "/post/setting-up-tradingagents-locally/"
+++

# Running TradingAgents locally

[Tauric TradingAgents](https://github.com/tauricresearch/tradingagents) is an open source project
that uses several AI agents to work through investment research. The agents take on different roles:
analysts, researchers, a trader, risk reviewers, and a portfolio manager. The project's README
explains how they work together. This post covers how I connected the framework to cloud and local
models, with a rate limiter to keep requests under control.

The usual setup needs API keys for cloud models. I already had AI subscriptions and wanted to use
whatever allowance I had left in those instead of paying separately for API calls.
So I put a local model gateway on my MacBook. It lets me inspect the traffic and limit requests,
and I can switch providers without changing the TradingAgents code.

Neither this article nor the TradingAgents project is financial advice. I treat the output as
AI-generated research notes that need checking, rather than a reason to buy or sell.

## The Architecture of my deployment

My local setup looks like this:

```mermaid
    Simple architecture diagram;
        Terminal --> TradingAgents (App);
        TradingAgents (App) --> Local Rate Limiter (Port 8318);
        Local Rate Limiter (Port 8318) --> CLIProxyAPI Gateway (Port 8317);
        CLIProxyAPI Gateway (Port 8317) --> Upstream Providers (Gemini, Codex, LM Studio Server, etc.);
```

CLIProxyAPI gives TradingAgents an OpenAI-compatible endpoint. Behind that endpoint, I can use
Gemini or Codex (or any other OpenAI-compatible LLM provider) through my subscriptions, or connect a local model. TradingAgents handles the
research; CLIProxyAPI handles access to whichever provider I choose.

The rate limiter sits between TradingAgents and the gateway. Several agents can send requests
at once, which can trigger provider limits, especially when using a subscription.
The small token-bucket proxy lets me control how quickly those requests reach the gateway.

## Before you start

I used a MacBook with Homebrew and Python 3.10+. You can run the setup on another machine,
though the Homebrew and macOS service commands below will need adapting.

I kept the Python environment in a `.venv` folder inside the project so it was easy to find
and inspect. If you prefer Conda or Docker, the upstream README covers those options.

## 1. Install TradingAgents in a local virtual environment

Clone the [Tauric TradingAgents repository](https://github.com/TauricResearch/TradingAgents),
then create a virtual environment and install the project:

```bash
git clone https://github.com/TauricResearch/TradingAgents.git
cd TradingAgents
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install .
```

To run `tradingagents` from any shell, add a symlink in a directory on your `PATH`.
For example, with `~/.local/bin`:

```bash
ln -s "$PWD/.venv/bin/tradingagents" ~/.local/bin/tradingagents
```

Make sure `~/.local/bin` is on your `PATH` for this shortcut to work.

## 2. Install CLIProxyAPI and sign in to your providers

CLIProxyAPI is the part that connects to an existing subscription, such as Google AI Pro
or OpenAI Codex. TradingAgents sends its requests to the local gateway.

Install CLIProxyAPI with Homebrew:

```bash
brew install cliproxyapi
```

Sign in to each provider you want to use. For Gemini, this opens a browser login:

```bash
cliproxyapi -login
```

For Codex, use the device login flow:

```bash
cliproxyapi -codex-device-login
```

Then restart the service:

```bash
brew services restart cliproxyapi
```

CLIProxyAPI saves the authentication tokens as `.json` files in `~/.cli-proxy-api`.

With my Homebrew installation, the configuration file is here:

```text
/opt/homebrew/etc/cliproxyapi.conf
```

I'm also sharing an example file in my config repo: https://github.com/atsamour/tradingagents-proxy-config

The template binds CLIProxyAPI to localhost and enables its Management Center.
It also defines the client key that TradingAgents will send with requests; you'll put that key
in the TradingAgents `.env` file later. Optional providers that use API keys stay disabled
until you supply their keys.

There are two local keys to keep track of:

- a client API key for requests from TradingAgents to CLIProxyAPI
- a management key for CLIProxyAPI's Management Center

Generate both keys and save their values. You'll need them again when configuring TradingAgents
and signing in to the Management Center:

```bash
CLIENT_KEY="tradingagents-$(openssl rand -hex 24)"
MGMT_KEY="mgmt-$(openssl rand -hex 24)"
echo $CLIENT_KEY
echo $MGMT_KEY
```

Back up the current configuration, replace the template's placeholders with your keys,
then install it and restart CLIProxyAPI:

```bash
cp /opt/homebrew/etc/cliproxyapi.conf /opt/homebrew/etc/cliproxyapi.conf.backup
cp config/cliproxyapi.conf.example /tmp/cliproxyapi.conf
perl -0pi -e "s/tradingagents-REPLACE_WITH_GENERATED_CLIENT_KEY/$CLIENT_KEY/g; s/mgmt-REPLACE_WITH_GENERATED_MANAGEMENT_KEY/$MGMT_KEY/g" /tmp/cliproxyapi.conf
install -m 600 /tmp/cliproxyapi.conf /opt/homebrew/etc/cliproxyapi.conf
brew services restart cliproxyapi
```

If your Homebrew directory requires elevated permissions, use them only for the `install` step.

Open the Management Center at:

```text
http://127.0.0.1:8317/management.html#/login
```

Sign in with the `MGMT_KEY` you generated above.

I keep CLIProxyAPI and its Management Center on the same machine as TradingAgents.
You could also run the gateway on a separate machine and configure network access to it.

## 3. Point TradingAgents at the local gateway

TradingAgents lets you override its model settings with environment variables.
Create a `.env` file in the TradingAgents repository:

```bash
# .env (Local Overrides)
OPENAI_API_KEY=CLIENT_KEY
TRADINGAGENTS_LLM_PROVIDER=gemini
TRADINGAGENTS_LLM_BACKEND_URL=http://127.0.0.1:8318/v1
TRADINGAGENTS_DEEP_THINK_LLM=gemini-3.1-pro-preview
TRADINGAGENTS_QUICK_THINK_LLM=gemini-3.1-flash-lite-preview
ALPHA_VANTAGE_API_KEY=your-alphavantage-key-here
CLIPROXYAPI_MANAGEMENT_KEY=your-generated-$MGMT_KEY
```
Get the ALPHA_VANTAGE_API_KEY here: https://www.alphavantage.co/support/#api-key. It is a stock market data retrieval API.

Use the `CLIENT_KEY` value you generated in the previous step.
The backend URL points to the rate limiter on port `8318`, a small Python script built with
`aiohttp`. Sending requests through it lets me control how quickly the agents use my subscription.

To find model names for `TRADINGAGENTS_DEEP_THINK_LLM` and `TRADINGAGENTS_QUICK_THINK_LLM`, run:

```text
scripts/app/tradingagents_models.sh list
```

Or query the model endpoint directly:

```text
curl -fsS \
  -H "Authorization: Bearer mgm-token-here" \
  http://127.0.0.1:8318/v1/models
```

Start the local rate limiter with:

```bash
scripts/app/cliproxyapi_rate_limiter_service.sh submit
```

## 4. Set up the rate limiter

CLIProxyAPI already handles retries, provider routing, and cooldowns.
I also wanted a requests-per-minute limit that I could set myself, right at the endpoint
TradingAgents calls.

The limiter is a small `aiohttp` reverse proxy in:

```text
scripts/app/cliproxyapi_rate_limiter.py
```

It listens on `127.0.0.1:8318` and forwards requests to `127.0.0.1:8317`.
You can check its health at:

```text
http://127.0.0.1:8318/healthz
```

I use these conservative defaults:

```text
10 requests per minute, burst 3
```

To change them, edit:

```text
config/cliproxyapi-rate-limiter.env
```

To keep the limiter running as a macOS service through `launchd`, use:

```bash
scripts/app/cliproxyapi_rate_limiter_service.sh submit
scripts/app/cliproxyapi_rate_limiter_service.sh status
```

For a foreground session that you start and stop yourself, use:

```bash
scripts/app/cliproxyapi_rate_limiter_service.sh start
scripts/app/cliproxyapi_rate_limiter_service.sh status
scripts/app/cliproxyapi_rate_limiter_service.sh stop
```

When a request includes a bearer token, the limiter uses its API key to choose a bucket.
That keeps request limits separate if several local clients use the gateway with different keys.

## 5. Switch models without editing `.env` by hand

It's easy to put a model name in `.env` that TradingAgents accepts but the gateway can't serve.
The helper script checks CLIProxyAPI's current model list before updating the file,
so you can catch that mistake before starting a run.

List available models:

```bash
scripts/app/tradingagents_models.sh list
```

Check which models TradingAgents is currently set to use:

```bash
scripts/app/tradingagents_models.sh show
```

Use the Gemini preset:

```bash
scripts/app/tradingagents_models.sh preset gemini
```

Use the Codex preset:

```bash
scripts/app/tradingagents_models.sh preset codex
```

Or choose the model IDs yourself:

```bash
scripts/app/tradingagents_models.sh set \
  --deep gemini-3.1-pro-preview \
  --quick gemini-3.1-flash-lite-preview
```

TradingAgents may warn that your Gemini or Codex model isn't in its built-in OpenAI model catalog.
That's expected when using the proxy. The helper checks the gateway's `/v1/models` response
to confirm which models it can serve.

Here are a few watchlist runs using the Gemini and Codex presets:

```bash
scripts/app/run_stock_watchlist.sh --mode news --model gemini PLTR GOOGL RHM.DE
scripts/app/run_stock_watchlist.sh --mode potential --model codex PLTR GOOGL RHM.DE
scripts/app/run_stock_watchlist.sh --mode full --model gemini PLTR
```

To preview the command without starting the research run, add `--dry-run`:

```bash
scripts/app/run_stock_watchlist.sh --mode news --model gemini --dry-run PLTR
```

The wrapper saves reports under:

```text
runs/tradingagents/<TICKER>/<DATE>/summary.md
runs/tradingagents/<TICKER>/<DATE>/reports/
```

### Check the setup

Before starting a full research run, I use the doctor script to check the setup.
It checks the Homebrew service and listening ports, then the Management Center,
provider status, and model selection. It also checks that the CLI starts and sends
a small completion request through the limiter:

```bash
scripts/setup/tradingagents_doctor.sh
```
This script checks if the ports are open, if the providers are authenticated, and runs a "smoke test" completion.

## Run a research session

Once those checks pass, I start the TradingAgents CLI for an interactive session:

```bash
tradingagents
```

You can choose which analyst teams to run, for example `market,news,fundamentals`.
Tickers can come from any market Yahoo Finance covers, including symbols such as `AAPL`,
`0700.HK`, or `BTC-USD`.

When I want to repeat the same research across a watchlist, I use the batch wrapper.
It saves the results as Markdown:

```bash
scripts/app/run_stock_watchlist.sh --mode full --model gemini PLTR GOOGL
```

The reports go into `runs/tradingagents/`. I can read through the bull and bear arguments
later without running the models again.

## Final Thoughts
I started this because I wanted to run TradingAgents locally without paying for extra API calls.
Keeping provider access in CLIProxyAPI and request limits in a separate proxy made the setup easier to manage.

If you're trying something similar, I'd recommend putting a gateway between your agents and the providers.
Being able to see the requests and slow them down when needed ensures that your AI subscription won't get banned.
It also gives you a place to start looking when an agent appears to be stuck or even review how agents operate based on the input they get.

As a next step I would like to run some benchmarks with past starting date (TradingAgenst support it!) and see if predictions are accurate and when not,
analyse why. Will post in due time. 

Please feel free to share your experience with useing TradingAgents and don't hesitate to comment if yuou have any issues running them locally, as described here.

NOTES:
* Τhis was tested on TradingAgents v0.2.5
* 
* All configs and scripts can be found here: https://github.com/atsamour/tradingagents-proxy-config 