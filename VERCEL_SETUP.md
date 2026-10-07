# Vercel Setup (Web) — Simple & Clean

## Step 1: Import the repo
1. Go to https://vercel.com/new
2. Import your GitHub repo (ProofMesh)
3. Framework: Next.js — auto-detected

## Step 2: Set Root Directory (CRITICAL)
Under "Configure Project":
- **Root Directory** → `apps/web`
- This is important because it's a monorepo

## Step 3: Add environment variables
Add this under Environment Variables:

```env
NEXT_PUBLIC_API_URL=https://<your-api>.up.railway.app
```

Leave `NEXT_PUBLIC_DEMO_WALLET` empty for production.

## Step 4: Deploy
1. Click Deploy
2. Vercel gives you `https://<your-app>.vercel.app`

## Step 5: Lock in CORS
Go back to Railway → API service → Variables:
```env
CORS_ORIGINS=https://<your-app>.vercel.app
```

Railway will auto-redeploy.

## Step 6: Test
Open your Vercel URL → Sign in with GitHub → Get Verified.

## If deployment still fails
The build succeeded locally (`pnpm build` works). The most common cause is Root Directory not set to `apps/web`. Make sure you set that in Step 2.
