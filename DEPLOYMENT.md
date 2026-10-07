# ProofMesh Deployment (Vercel + Railway)

This guide covers deploying ProofMesh for free using **Vercel** (web) and **Railway** (API).

## Prerequisites

- A [GitHub](https://github.com/) repository with this code pushed
- A [Vercel](https://vercel.com/) account (free)
- A [Railway](https://railway.app/) account (free, $5/mo credit)
- A [Neon](https://neon.tech/) Postgres database (free)
- A [Upstash](https://upstash.com/) Redis instance (free)
- A [GitHub App](https://github.com/settings/apps) (already configured in the repo)

## 1. Prepare the Solana issuer keypair for Railway

Railway cannot mount files. Encode your devnet keypair as base64.

```bash
# From repo root
node -e "
const fs = require('fs');
const key = fs.readFileSync('.secrets/proofmesh-devnet.json');
process.stdout.write(key.toString('base64'));
" | pbcopy
```

Or on macOS without pbcopy, just output it. Save this value as `SOLANA_KEYPAIR` in Railway.

## 2. Deploy the API to Railway

1. Go to [railway.app](https://railway.app/) → **New Project** → **Deploy from GitHub repo**
2. Select your ProofMesh repository
3. Railway will auto-detect the Dockerfile via `railway.json`
4. Add the following environment variables in the Railway dashboard:

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Your Neon connection string | Postgres |
| `REDIS_URL` | Your Upstash Redis URL | Optional (omit to run in-process) |
| `GITHUB_TOKEN` | GitHub personal access token | For ingestion |
| `GITHUB_APP_ID` | `5199842` | From repo |
| `GITHUB_APP_CLIENT_ID` | `Iv23li8TGy5QTQZb6IVb` | From repo |
| `GITHUB_APP_CLIENT_SECRET` | From GitHub App settings | Secret |
| `GITHUB_APP_WEBHOOK_SECRET` | `proofmesh-webhook-secret` | From repo |
| `SOLANA_KEYPAIR` | Base64-encoded keypair | From step 1 |
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` | Devnet |
| `LLM_API_KEY` | Your Gemini API key | Optional (omit for deterministic-only) |
| `PUBLIC_API_URL` | `https://your-api.up.railway.app` | Set after first deploy |
| `CORS_ORIGINS` | `https://your-app.vercel.app` | Set after Vercel deploy |

5. Deploy. Railway will give you a URL like `https://proofmesh-api-xxx.up.railway.app`. Update `PUBLIC_API_URL` with this value and redeploy if needed.

## 3. Update the GitHub App webhook

1. Go to [github.com/settings/apps](https://github.com/settings/apps) → **ProofMesh**
2. Webhook → **Payload URL**: `https://your-api.up.railway.app/api/github/webhook`
3. Content type: `application/json`
4. Save

## 4. Deploy the web app to Vercel

1. Go to [vercel.com](https://vercel.com/) → **New Project** → Import your GitHub repo
2. Framework Preset: **Next.js** (auto-detected)
3. Set environment variables:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://your-api.up.railway.app` |
| `NEXT_PUBLIC_DEMO_WALLET` | *(omit in production)* |

4. Deploy. Vercel gives you `https://your-app.vercel.app`

## 5. Update CORS

Back in Railway, set:
```env
CORS_ORIGINS=https://your-app.vercel.app
```

Redeploy the API.

## 6. Test

1. Open `https://your-app.vercel.app`
2. Click **Get Verified**
3. Sign in with GitHub
4. Connect a Solana wallet
5. Run the analysis pipeline
6. Mint a credential (if eligible) or view the evidence report

## Notes

- The API supports running without Redis (in-process queue). If `REDIS_URL` is omitted, analyses run synchronously in the same process.
- For deterministic-only mode, omit `LLM_API_KEY`. The skeptic/reviewer will be disabled.
- The Solana issuer must have devnet SOL. Fund it via [Solana Faucet](https://faucet.solana.com/).
