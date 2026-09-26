# Vercel Deployment Guide

Deploy FleetFail to Vercel from Origin.

## Prerequisites

- Vercel account (create at [vercel.com](https://vercel.com))
- Origin repository access

## Connecting Origin to Vercel

1. Go to your Vercel dashboard
2. Click **Add New... → Project**
3. Select **Continue with Origin** (or use "Import Third-Party Git Repository" with Origin repo URL)
4. Authenticate with your Origin account if prompted
5. Select the `fleetfail` repository

## Project Configuration

### Root Directory

Set **Root Directory** to:

```
apps/web
```

### Framework Preset

Select **Next.js** as the framework preset (should auto-detect).

### Build Settings

These should auto-configure, but verify:

| Setting | Value |
|---------|-------|
| Framework Preset | Next.js |
| Root Directory | `apps/web` |
| Build Command | `cd ../.. && pnpm install && pnpm build` |
| Output Directory | `.next` |
| Install Command | `pnpm install` |

## Environment Variables

Add these environment variables in Vercel Dashboard → Project Settings → Environment Variables.

**Important:** These are server-only variables. Do NOT prefix with `NEXT_PUBLIC_`.

| Variable | Description | Required |
|----------|-------------|----------|
| `ERCOT_API_USERNAME` | ERCOT B2C account email | No (optional for LIVE data) |
| `ERCOT_API_PASSWORD` | ERCOT B2C account password | No (optional for LIVE data) |
| `ERCOT_PUBLIC_API_SUBSCRIPTION_KEY` | Azure APIM subscription key | No (optional for LIVE data) |

### ERCOT Credential Behavior

**With credentials configured and API accessible:**
- UI displays **LIVE** badge
- Real-time ERCOT grid data with 5-minute cache TTL

**Without credentials OR if API fails:**
- UI displays **"Cached / Replay — Live ERCOT unavailable"** badge
- Fixture data from September 2024 snapshot is shown
- Demo remains fully functional

The application never silently shows fixture data as live. The banner always indicates the true data source.

## Deployment

1. After configuring settings, click **Deploy**
2. Wait for build to complete
3. Visit the production URL

## Verifying Deployment

After deployment:

1. Navigate to the root URL (`/`) - Ops Console
2. Check the ERCOT Grid section for data source badge:
   - **LIVE** (green) = credentials configured and API working
   - **Cached / Replay — Live ERCOT unavailable** (yellow) = fixture data
3. Navigate to `/map` - Map View
4. Verify the same badge appears in the sidebar

## Notes

- Do NOT mirror to GitHub; deploy directly from Origin
- Fleet devices are synthetic (see SYNTHETIC DISCLAIMER in footer)
- For production ERCOT integration, obtain credentials from ERCOT:
  - Register at [ERCOT API Portal](https://www.ercot.com/services/api)
  - Subscribe to the Public API
  - Obtain Azure APIM subscription key
