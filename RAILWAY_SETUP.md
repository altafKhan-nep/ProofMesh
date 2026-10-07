# Railway Setup (API) — Simple & Clean

This is the fastest way to get the API live on Railway.

## Prerequisites
- GitHub repo pushed with the changes we just committed
- Railway account (https://railway.app/)
- Neon Postgres + Upstash Redis URLs
- Solana devnet keypair (optional now for just deploying; needed to mint)

## Step 1: Create project on Railway
1. Go to https://railway.app/new
2. Select "Deploy from GitHub repo"
3. Pick your ProofMesh repo
4. Railway will auto-detect settings from `railway.json` + Dockerfile

## Step 2: Get the base64 keypair (once)
```bash
node -e "
const fs=require('fs');
const k=fs.readFileSync('.secrets/proofmesh-devnet.json');
process.stdout.write(k.toString('base64'));
"
```

Copy the output.

## Step 3: Add required environment variables (minimum viable set)
In Railway → your API service → Variables, add these:

```env
# Database
DATABASE_URL=<your-neon-connection-string>

# GitHub App (core)
GITHUB_APP_ID=5199842
GITHUB_APP_CLIENT_ID=Iv23li8TGy5QTQZb6IVb
GITHUB_APP_CLIENT_SECRET=<from-github-app>
GITHUB_APP_WEBHOOK_SECRET=proofmesh-webhook-secret

# Solana (issuer)
SOLANA_KEYPAIR=<base64-from-step-2>
SOLANA_RPC_URL=https://api.devnet.solana.com

# API + CORS (fill after getting URLs)
PUBLIC_API_URL=https://<your-api>.up.railway.app
CORS_ORIGINS=http://localhost:3000
```

Optional (recommended if you have them): `REDIS_URL`, `GITHUB_TOKEN`, `LLM_API_KEY`.

## Step 4: Deploy & get your API URL
1. Railway will deploy automatically after adding vars
2. Click the service → Settings → Networking → Generate Domain (or look at the deployment URL)
3. Copy `https://<your-service>.up.railway.app`
4. Update `PUBLIC_API_URL` in Railway Variables to this exact URL
5. Update `CORS_ORIGINS` later to your Vercel URL (we'll do that next)

## Step 5: Set GitHub App webhook
1. GitHub → Settings → Developer settings → GitHub Apps → ProofMesh
2. Webhook → Payload URL: `https://<your-api>.up.railway.app/api/github/webhook`
3. Save

## Done (API)
Your API is live. Next: Vercel (web).
