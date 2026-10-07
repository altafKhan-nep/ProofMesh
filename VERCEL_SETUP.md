# Vercel Setup (Web) — Simple & Clean

## Step 1: Import the repo
1. Go to https://vercel.com/new
2. Import your GitHub repo (ProofMesh)
3. Framework: Next.js — auto-detected

## Step 2: Add environment variables
In "Environment Variables" add:

```env
NEXT_PUBLIC_API_URL=https://<your-api>.up.railway.app
```

Leave `NEXT_PUBLIC_DEMO_WALLET` empty for production.

## Step 3: Deploy
1. Click Deploy
2. Vercel gives you `https://<your-app>.vercel.app`

## Step 4: Lock in CORS
Go back to Railway → API service → Variables:
```env
CORS_ORIGINS=https://<your-app>.vercel.app
```

Railway will auto-redeploy.

## Step 5: Test
Open your Vercel URL → Sign in with GitHub → Get Verified.
