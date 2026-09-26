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
- UI displays **LIVE** badge for both grid load and settlement point prices
- Real-time ERCOT grid data with 5-minute cache TTL
- Real-time SPP prices (RT + DAM) with 1-minute cache TTL

**Without credentials OR if API fails:**
- Grid load: **"Cached / Replay — Live ERCOT unavailable"** badge with fixture data
- SPP prices: **"Unavailable"** badge (never invents price data)
- Demo remains functional for grid load; price advisor unavailable

The application never silently shows fixture data as live. The banner always indicates the true data source.

### Data Sources

| Data | API Endpoint | Description |
|------|--------------|-------------|
| Grid Load | `/np6-345-cd/act_sys_load_by_wzn` | Actual load by weather zone |
| Load Forecast | `/np3-565-cd/lf_by_model_weather_zone` | Load forecast by zone |
| Wind | `/np4-742-cd/wpp_hrly_actual_fcast_geo` | Wind actual/forecast |
| Solar | `/np4-745-cd/spp_hrly_actual_fcast_geo` | Solar actual/forecast |
| RT SPP | `/np6-905-cd/spp_node_zone_hub` | Real-time settlement point prices |
| DAM SPP | `/np4-190-cd/dam_stlmnt_pnt_prices` | Day-ahead settlement point prices |

### Default Settlement Point

The arb windows advisor uses **HB_HUBAVG** (ERCOT Hub Average) as the default settlement point.

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
