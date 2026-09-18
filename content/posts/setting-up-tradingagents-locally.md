+++
title = "TradingAgends local setup of multi-agents LLM Trading Framework"
description = "Habit@weave is a web application for the control and monitoring smart homes and wearable devices"
tags = [ "AI", "finance", "trading", "TauricResearch" ]
date = "2026-06-07"
categories = [
"AI",
"finance"
]
slug = "setting-up-tradingagents-locally"
url = "/post/setting-up-tradingagents-locally/"
+++

# Building a Local Multi-Agent Trading Research Stack

[Tauric TradingAgents](https://github.com/tauricresearch/tradingagents) is an open source project that automates investment research
with a coordinated multi-agent workflow. It provides AI analysts, researchers, a trader, risk
reviewers, and a portfolio manager. The project's README explains well what the framework can do, so
here we focus on wiring it to LLM providers (cloud or local) and running locally with rate limiting.

While the framework works great out of the box, it requires API keys for Cloud-based LLMs.
Wouldn't it be wonderful to use the remaining (if any :) tokens fo your Google AI Pro or OpenAI Codex subscriptions instead?
Personally, I didn't want to pay extra for API calls, so used the approach of a local model gateway 
on my MacBook. That way, I could inspect traffic, enforce rate limits on LLM calls,
and switch providers without touching a single line of application code.

Keep in mind, that this article, as the initial project itself is not financial advice. The output of this stack should be treated as
research notes from a probabilistic system, not as a signal to buy or sell.

## The Architecture

My local setup looks like this:

```mermaid
    Simple architecture diagram;
        Terminal --> TradingAgents (App);
        TradingAgents (App) --> Local Rate Limiter (Port 8318);
        Local Rate Limiter (Port 8318) --> CLIProxyAPI Gateway (Port 8317);
        CLIProxyAPI Gateway (Port 8317) --> Upstream Providers (Gemini, Codex, LM Studio Server, etc.);
```

This configuration gives two big advantages. By using CLIProxyAPI as the gateway,
I can treat TradingAgents as if it's talking to OpenAI APIs, even when it's actually hitting 
Gemini, a custom Codex endpoint (all available with your monthly subscriptions) or a local LLM provider.
Adding a small token-bucket rate limiter in front of the gateway prevents the "multi-agent burst" problem;
where five agents hitting an API simultaneously can trigger provider-side blocks (especially if instead of API key you're using an AI subscription).
Routing through CLIProxyAPI gave the project a clean boundary.
TradingAgents is responsible for market-research orchestration, while
CLIProxyAPI is responsible for provider access.

We're going to dive deeper into this setup

## Getting Started

We assume a MacBook with Homebrew and Python 3.10+, but any computer can be used.

I used a local virtual environment inside the project folder instead of Conda or
Docker. The upstream README documents the other installation paths;
I chose the venv route, because it kept this project compact and easy to inspect.

## 1. Install TradingAgents in a Local Virtual Environment

Clone the repository from here: https://github.com/TauricResearch/TradingAgents and install it into `.venv`:

```bash
git clone https://github.com/TauricResearch/TradingAgents.git
cd TradingAgents
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install .
```

If you want `tradingagents` available from any shell, add a symlink somewhere on
your `PATH`, e.g.:

```bash
ln -s "$PWD/.venv/bin/tradingagents" ~/.local/bin/tradingagents
```
Make sure `~/.local/bin` is on your `PATH` before relying on the shortcut.

## 2. Install and Authenticate the CLIProxyAPI bridge

This is a key part of this tutorial and will enable us to use an existing AI subscription, like Google AI Pro or OpenAI Codex
instead of paying for expensive API calls.

Install CLIProxyAPI with Homebrew:
```bash
brew install cliproxyapi
```

Authenticate the upstream providers you plan to use.
For Gemini, the local flow is browser-based:
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

It will save your authentication tokens in .json files in ~/.cli-proxy-api.

The installed CLIProxyAPI config lives at (if your used homebrew to install):

```text
/opt/homebrew/etc/cliproxyapi.conf
```

There is an example configuration template in the project at:

```text
config/cliproxyapi.conf.example
```

The template binds CLIProxyAPI to localhost, enables the Management Center,
defines the TradingAgents client key (a secret that you need to pass to TradingAgents via its .env file),
and leaves optional some API-key-based provider slots, disabled until keys are supplied.

The stack uses two separate local secrets:

- a client API key that TradingAgents sends to access CLIProxyAPI
- a management key to access CLIProxyAPI's local Management web UI

Generate generate and note them. You're gonna need them later:

```bash
CLIENT_KEY="tradingagents-$(openssl rand -hex 24)"
MGMT_KEY="mgmt-$(openssl rand -hex 24)"
echo $CLIENT_KEY
echo MGMT_KEY
```

Apply the config with the generated local keys to CLIProxyAPI:

```bash
cp /opt/homebrew/etc/cliproxyapi.conf /opt/homebrew/etc/cliproxyapi.conf.backup
cp config/cliproxyapi.conf.example /tmp/cliproxyapi.conf
perl -0pi -e "s/tradingagents-REPLACE_WITH_GENERATED_CLIENT_KEY/$CLIENT_KEY/g; s/mgmt-REPLACE_WITH_GENERATED_MANAGEMENT_KEY/$MGMT_KEY/g" /tmp/cliproxyapi.conf
install -m 600 /tmp/cliproxyapi.conf /opt/homebrew/etc/cliproxyapi.conf
brew services restart cliproxyapi
```

If your Homebrew prefix requires elevated permissions, run only the install step
with the permissions your machine requires.

Now you can access the Management Center of CLIProxyAPI:

```text
http://127.0.0.1:8317/management.html#/login
```

Use the generated `MGMT_KEY` to login.

This will be used locally in our approach, but of course nothing stops you from deploying 
the CLIProxyAPI on a separate machine and making the management UI accessible from network.

## 4. Configure TradingAgents to Use the Local Gateway

TradingAgents supports environment-variable overrides for its LLM configuration.
Create a local `.env` file in the same repo where the tradingAgents project is located:

```bash
# .env (Local Overrides)
OPENAI_API_KEY=CLIENT_KEY
TRADINGAGENTS_LLM_PROVIDER=gemini
TRADINGAGENTS_LLM_BACKEND_URL=http://127.0.0.1:8318/v1
TRADINGAGENTS_DEEP_THINK_LLM=gemini-3.1-pro-preview
TRADINGAGENTS_QUICK_THINK_LLM=gemini-3.1-flash-lite-preview
ALPHA_VANTAGE_API_KEY=your-key-here    TODO
CLIPROXYAPI_MANAGEMENT_KEY=your-mgmt-key   ????
```

The `CLIENT_KEY` was generated in the previous step.
By pointing `TRADINGAGENTS_LLM_BACKEND_URL` to the local rate limiter (small python script that uses `aiohttp`  and configured to run on `:8318`),
we can control Agents' appetite and protect API consumption of getting our subscription banned.

To figure out which values are accepted for TRADINGAGENTS_DEEP_THINK_LLM & TRADINGAGENTS_QUICK_THINK_LLM, run:
```text
scripts/app/tradingagents_models.sh list
```

or execute

```text
curl -fsS \
  -H "Authorization: Bearer mgm-token-here" \
  http://127.0.0.1:8318/v1/models
```

To start the Local Rate Limiter:

```bash
scripts/app/cliproxyapi_rate_limiter_service.sh submit
```


## 5. Add a Local Token-Bucket Rate Limiter

CLIProxyAPI already handles retries, provider routing, and cooldown behavior.
What I wanted in front of TradingAgents was more basic: a requests-per-minute
limit at the exact endpoint the app calls.

The local limiter in this project is a small `aiohttp` reverse proxy:

```text
scripts/app/cliproxyapi_rate_limiter.py
```

It listens on `127.0.0.1:8318`, forwards traffic to `127.0.0.1:8317`, and
exposes:

```text
http://127.0.0.1:8318/healthz
```

The default policy is intentionally conservative:

```text
10 requests per minute, burst 3
```

Those values can be overridden in:

```text
config/cliproxyapi-rate-limiter.env
```

For a persistent macOS launchd-backed job:

```bash
scripts/app/cliproxyapi_rate_limiter_service.sh submit
scripts/app/cliproxyapi_rate_limiter_service.sh status
```

For a foreground-session fallback:

```bash
scripts/app/cliproxyapi_rate_limiter_service.sh start
scripts/app/cliproxyapi_rate_limiter_service.sh status
scripts/app/cliproxyapi_rate_limiter_service.sh stop
```

The limiter buckets requests by API key when a bearer token is present. That is
useful because the gateway can keep behavior predictable even if more than one
local client eventually uses it.

## 6. Switch Models Without Editing by Hand

When routing models through a proxy, the easy mistake is to set a model name
that TradingAgents accepts syntactically but the gateway cannot actually serve.
The helper script avoids that by checking CLIProxyAPI's live model list before
writing `.env`.

List available models:

```bash
scripts/app/tradingagents_models.sh list
```

Show the current TradingAgents model configuration:

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

Or set explicit IDs:

```bash
scripts/app/tradingagents_models.sh set \
  --deep gemini-3.1-pro-preview \
  --quick gemini-3.1-flash-lite-preview
```

TradingAgents may warn that a proxied Gemini or Codex model is not in its
built-in OpenAI model catalog. In this setup, that warning is expected. The
important validation happens against CLIProxyAPI's `/v1/models` response.



Examples:

```bash
scripts/app/run_stock_watchlist.sh --mode news --model gemini PLTR GOOGL RHM.DE
scripts/app/run_stock_watchlist.sh --mode potential --model codex PLTR GOOGL RHM.DE
scripts/app/run_stock_watchlist.sh --mode full --model gemini PLTR
```

Preview without running:

```bash
scripts/app/run_stock_watchlist.sh --mode news --model gemini --dry-run PLTR
```

Reports are saved under:

```text
runs/tradingagents/<TICKER>/<DATE>/summary.md
runs/tradingagents/<TICKER>/<DATE>/reports/
```

### Verification of the setup

After the setup, you can verify each layer separately
before asking a multi-agent graph to run. The local doctor script checks the
Homebrew service, listening ports, Management UI, provider status, model
selection, CLI startup, and a tiny completion through the limiter:

```bash
scripts/setup/tradingagents_doctor.sh
```

This script checks if the ports are open, if the providers are authenticated, and runs a "smoke test" completion.
Can save hours of debugging "why is the agent hanging?".

## Running the Stack

Once the bridge is healthy, I use the TradingAgents CLI for interactive research:

```bash
tradingagents
```

You can target specific analyst teams (like `market,news,fundamentals`) and use tickers from any market Yahoo Finance covers (e.g., `AAPL`, `0700.HK`, or `BTC-USD`).

For repeatable research, I use a batch wrapper that saves everything as Markdown:

```bash
scripts/app/run_stock_watchlist.sh --mode full --model gemini PLTR GOOGL
```

This dumps detailed reports into `runs/tradingagents/`, which is great for reviewing the "bull vs bear" debates later without re-running the models.

## Final Thoughts
I started this because I wanted to run TradingAgents locally without paying for extra API calls.
Keeping provider access in CLIProxyAPI and request limits in a separate proxy made the setup easier to manage.

If you're trying something similar, I'd recommend putting a gateway between your agents and the providers.
Being able to see the requests and slow them down when needed ensures that your AI subscription won't get banned.
It also gives you a place to start looking when an agent appears to be stuck or even review how agents operate based on the  
