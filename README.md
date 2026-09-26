# FleetFail ⚡ — Resilient Dispatch Simulator

> **Base Power × AITX Hackathon** — Orchestration + Open Grid Data Tracks
> 
> Deadline: Sunday 2026-09-27 10:00 AM America/Chicago

---

## ⚠️ SYNTHETIC DISCLAIMER

**This is NOT Base proprietary architecture.** All datasets, telemetry, and demo figures are **synthetic** unless a file explicitly states otherwise.

- **Fleet devices**: ~20,000 synthetic battery devices with deterministically seeded positions for demonstration.
- **Weather zones**: Load/renewables impact forecasts derived from ERCOT weather-zone geography — not raw NWS data.
- **Settlement prices**: Wholesale SPP $/MWh from ERCOT Public API (when credentials configured) — not residential retail rates.
- **Bill Stress**: Not implemented (P2 backlog).

---

## Overview

FleetFail is a synthetic residential battery fleet orchestrator that proves aggregate dispatch recovers under partial failure **without**:
- Duplicate kW effects
- Stale command execution  
- Reserve violations

**Claim:** At-least-once delivery with idempotent effect (NOT exactly-once).

The system demonstrates that even with network partitions, lost ACKs, duplicate deliveries, and device reconnections, the fleet maintains invariants and the dispatch either converges or gracefully reports capacity shortfall.

---

## Quick Start

```bash
# Install dependencies (requires Node.js 20+ and pnpm 9+)
pnpm install

# Run the tests (P0 kill-gate)
pnpm test

# Start the development server
pnpm dev

# Open in browser
open http://localhost:43210
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm install` | Install all dependencies |
| `pnpm dev` | Start development server on port 43210 |
| `pnpm build` | Build for production |
| `pnpm test` | Run P0 kill-gate tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm typecheck` | TypeScript type checking |
| `pnpm lint` | Run linting |

---

## Environment Variables

### ERCOT API Credentials (Server-Only)

| Variable | Description |
|----------|-------------|
| `ERCOT_API_USERNAME` | ERCOT B2C account email |
| `ERCOT_API_PASSWORD` | ERCOT B2C account password |
| `ERCOT_PUBLIC_API_SUBSCRIPTION_KEY` | Azure APIM subscription key |

**Without credentials:** System uses fixture data (Sep 2024 snapshot) — fully functional demo.  
**With credentials:** System fetches live ERCOT grid data.

> **Important:** These are server-only variables. Do NOT prefix with `NEXT_PUBLIC_`.

### Local Development Setup

For local `pnpm dev`, place env vars in **`apps/web/.env.local`**:

```bash
cp .env.example apps/web/.env.local
# Then edit apps/web/.env.local with your credentials
```

> **⚠️ Common Mistake:** The Next.js app only reads env vars from `apps/web/.env.local`. Placing credentials in `packages/engine/.env.local` or the repo root alone will **not** work — the web app won't see them.

After adding or changing env vars, **restart `pnpm dev`**.

**Grid Status Badge:** The Grid panel shows "LIVE" only when credentials are present **AND** the ERCOT fetch succeeds. Otherwise it displays "Cached / Replay" with the data source.

---

## ERCOT Data Honesty Policy

FleetFail follows strict honesty about data provenance. The UI always indicates the true source.

### Grid Load Data

| Condition | Badge |
|-----------|-------|
| Credentials present AND fetch succeeds | **LIVE** (green pulsing indicator) |
| Missing credentials OR API fails | **"Cached / Replay — Live ERCOT unavailable"** (yellow) |

### Settlement Point Prices (Arb Windows)

| Condition | Badge |
|-----------|-------|
| Credentials present AND fetch succeeds | **LIVE** (green pulsing indicator) |
| Missing credentials OR API fails | **"Unavailable"** — never invents SPP numbers |

The system never silently shows fixture data as live.

---

## Arb Windows Advisor (P0)

Wholesale settlement point price signals for charge/discharge window recommendations.

**Configuration:**
- **Settlement Point:** `HB_HUBAVG` (ERCOT Hub Average)
- **Horizon:** ~24 hours of Day-Ahead Market (DAM) prices
- **Edge Threshold:** $5/MWh minimum spread required

**Algorithm:**
1. Over next 24 DAM hours, find argmin (charge window — buy low) and argmax (discharge window — sell high)
2. Require (discharge − charge) ≥ **$5/MWh** edge threshold
3. If spread < $5/MWh: display "no arb edge"

**UI Display (on `/` and `/map`):**
- **Now $/MWh** — current real-time settlement price
- **Charge Window** — best time to buy (lowest price)
- **Discharge Window** — best time to sell (highest price)
- **Spread** — $/MWh difference (green if ≥$5)

**Data Sources:**
| Data | API Endpoint |
|------|--------------|
| RT SPP | `/np6-905-cd/spp_node_zone_hub` (15-min real-time) |
| DAM SPP | `/np4-190-cd/dam_stlmnt_pnt_prices` (hourly day-ahead) |

> **Note:** This is an advisor only. Arm/execute arb mode is not implemented (out of scope).

---

## Fleet Map View

The `/map` page displays **~20,000 synthetic battery devices** across Texas (ERCOT) and Illinois (MISO) regions.

**Fleet Distribution:**
- **Texas (ERCOT):** 70% of devices across 8 weather zones
- **Illinois (MISO):** 30% of devices across 4 load zones
- **Gen1 Devices:** 25kW / 50kWh (60% of fleet)
- **Gen3 Devices:** 40kW / 80kWh (40% of fleet)

**Map Features:**
- Leaflet.markercluster for efficient 20k device rendering
- Cluster aggregation at zoom-out, individual markers at zoom-in
- Viewport-based API serving (does not dump 20k per poll)
- Click device marker to take offline (real fault/command path)
- Click zone name to trigger mass outage

**Basemap:** OpenStreetMap (no API key required).

---

## Grid Data Sources

### ERCOT Live API (when credentials configured)

- **Source:** ERCOT Public API (https://api.ercot.com/api/public-reports)
- **Auth:** OAuth2 ROPC flow via Azure B2C
- **Endpoints:**
  - `/np6-345-cd/act_sys_load_by_wzn` — Actual load by weather zone
  - `/np3-565-cd/lf_by_model_weather_zone` — Load forecast by weather zone
  - `/np4-742-cd/wpp_hrly_actual_fcast_geo` — Wind actual/forecast
  - `/np4-745-cd/spp_hrly_actual_fcast_geo` — Solar actual/forecast
- **Caching:** 5-minute server-side TTL for grid data, 1-minute for prices

### ERCOT Fixture (fallback)

- **Source:** ERCOT Grid Operations Dashboard (https://www.ercot.com/gridmktinfo/dashboards)
- **Capture:** September 2024 snapshot, afternoon peak period
- **Data:** Weather-zone load, wind/solar generation, temperature, net load

### Illinois Zones (Synthetic)

- **Structure:** Based on MISO Zone 4/6 geography
- **Data:** Synthetic load values for demonstration

---

## Demo Flow

### Recommended Demo Order

**1. Reliability (Ops Console `/`)** → **2. Map Reallocation (`/map`)** → **3. Price Windows**

### Ops Console (`/`)

1. Open http://localhost:43210
2. Click "Start Dispatch" with 400 kW target
3. Watch devices receive commands and ACK
4. Click "Mass Outage" (takes 10 devices offline)
5. Observe:
   - `ACK_TIMEOUT` events for offline devices
   - `RETRY_SAME_ID` events with same idempotency key
   - `REALLOCATED` events moving power to available devices
   - `DEVICE_EXCLUDED` events for failed devices
6. Click "Restore All"
7. Observe:
   - `DEVICE_RECONNECTED` events with new epochs
   - `STALE_REJECTED` events for old commands
   - Dispatch converges to target
8. Review metrics: duplicates ignored, stale rejected, reallocations

### Texas Map View (`/map`)

1. Navigate to http://localhost:43210/map (or click "Texas Map View" from ops console)
2. View ~20,000 synthetic devices clustered across TX and IL regions
3. Zoom out for clusters, zoom in for individual devices
4. Start a 400kW dispatch from the side strip
5. **Zoom in and click a device marker** to take it offline
6. Observe:
   - Device turns red/offline on map
   - Surviving devices pulse/glow (working harder via `REALLOCATED` events)
   - Side strip shows rising reallocations count
7. Click zone name in side strip to trigger mass outage for that zone
8. Check ERCOT banner for data source indicator

### Price Windows (Arb Advisor)

1. On either `/` or `/map`, view the "Wholesale SPP" strip
2. Check the data source badge (LIVE / Unavailable)
3. If LIVE: observe current price, charge/discharge windows, spread
4. If spread ≥$5/MWh: green indicator shows arbitrage opportunity
5. If spread <$5: "No arb edge" warning

---

## Architecture

```
fleetfail/
├── packages/
│   └── engine/          # Pure TypeScript domain engine (no React deps)
│       ├── src/
│       │   ├── types.ts           # Domain types: Device, Command, Dispatch, Event
│       │   ├── device.ts          # Device operations, fleet seeding
│       │   ├── command.ts         # Command lifecycle, idempotency validation
│       │   ├── dispatch.ts        # Dispatch allocation and convergence
│       │   ├── event.ts           # Event factory functions
│       │   ├── orchestrator.ts    # Main simulation engine
│       │   ├── fault-injection.ts # Fault injection system
│       │   ├── db.ts              # SQLite persistence with write-behind
│       │   ├── random.ts          # Seeded PRNG for determinism
│       │   ├── ercot.ts           # Synthetic ERCOT zone fixtures
│       │   ├── ercot-cache.ts     # ERCOT data caching layer
│       │   ├── ercot-fixture.ts   # Real ERCOT snapshot (Sep 2024)
│       │   ├── ercot-prices.ts    # Settlement point price types
│       │   └── zone-allocator.ts  # Zone-preference allocation
│       └── vitest.config.ts
├── apps/
│   └── web/             # Next.js App Router UI
│       ├── src/
│       │   ├── app/
│       │   │   ├── page.tsx       # Ops Console dashboard
│       │   │   ├── map/page.tsx   # Texas Map View
│       │   │   └── api/           # REST endpoints
│       │   ├── components/        # React components
│       │   └── lib/
│       │       └── ercot-live.ts  # Live ERCOT API client (server-only)
│       └── next.config.mjs
├── docs/
│   └── vercel.md        # Vercel deployment guide
├── pnpm-workspace.yaml
└── package.json
```

---

## Key Concepts

### Units

| Unit | Description |
|------|-------------|
| **kW** | Power (rate of energy delivery). Used for dispatch targets and setpoints. |
| **kWh** | Energy (capacity). Used for battery storage capacity. |
| **SOC** | State of Charge (0-100%). Current battery level. |
| **Reserve** | Minimum SOC to maintain (default 20%). Prevents over-discharge. |
| **Freshness** | Maximum age of telemetry before considered stale (default 30s). |

### Idempotency Mechanism

1. Each command carries an `idempotencyKey` = `{dispatchId}-{deviceId}-{epoch}-{sequence}`
2. Devices track processed keys in a Set
3. On delivery, device checks if key exists → returns `DUPLICATE_IGNORED`
4. On success, device adds key to processedKeys and updates lastSequence

### Epoch/Sequence for Stale Detection

1. Device starts with `epoch=1, lastSequence=0`
2. Each command gets current device epoch and incrementing sequence
3. On device reconnect: `epoch++, lastSequence=0`
4. On command validation:
   - If `cmd.epoch < device.epoch` → `STALE_REJECTED`
   - If `cmd.epoch == device.epoch && cmd.sequence <= device.lastSequence` → `STALE_REJECTED`

### Event Types

| Event | Description |
|-------|-------------|
| `COMMAND_SENT` | Command dispatched to device |
| `COMMAND_ACKED` | Device acknowledged command |
| `ACK_TIMEOUT` | No ACK received within timeout |
| `RETRY_SAME_ID` | Retrying with same idempotency key |
| `DUPLICATE_IGNORED` | Duplicate delivery detected and ignored |
| `STALE_REJECTED` | Command from old epoch rejected |
| `DEVICE_EXCLUDED` | Device excluded from allocation |
| `REALLOCATED` | Power reallocated to different device |
| `DEVICE_OFFLINE` | Device went offline |
| `DEVICE_RECONNECTED` | Device reconnected with new epoch |
| `DISPATCH_STARTED` | Dispatch initiated |
| `DISPATCH_CONVERGED` | Dispatch met target |
| `DISPATCH_PARTIAL` | Dispatch partially completed |
| `DISPATCH_INSUFFICIENT` | Target exceeds available capacity |

---

## P0 Kill Gate Tests

All tests in `packages/engine/src/orchestrator.test.ts`:

✅ Fleet seeds 50 devices deterministically  
✅ Dispatch allocates and converges on target  
✅ **Lost ACK → retry with same idempotency key**  
✅ **Duplicate delivery ignored (no double kW effect)**  
✅ **Stale commands rejected on reconnect**  
✅ Reserve protection respected  
✅ **Reallocation on device failure**  
✅ **INSUFFICIENT_CAPACITY on target > fleet capacity**  
✅ All event types emitted correctly  
✅ Metrics accurately tracked  
✅ Deterministic with same seed  

Run tests:
```bash
pnpm test
```

---

## P1 Features (Implemented)

- ✅ **20k Device Scale**: ~20,000 devices across Texas and Illinois
- ✅ **TX + IL Geography**: 70% Texas (8 ERCOT zones), 30% Illinois (4 MISO zones)
- ✅ **Gen1/Gen3 Devices**: Gen1 (25kW/50kWh) and Gen3 (40kW/80kWh)
- ✅ **Map Clustering**: Leaflet.markercluster for 20k device rendering
- ✅ **Viewport API**: Returns only viewport devices (no 20k dump)
- ✅ **Real ERCOT Fixture**: Cached data from September 2024
- ✅ **Live ERCOT Integration**: When credentials configured
- ✅ **Fleet Map View** (`/map`): Interactive map with device clusters
- ✅ **Click-to-Offline**: Click device marker to take offline
- ✅ **Reallocation Visuals**: Devices pulse/glow on reallocation
- ✅ **Zone Mass Outage**: Click zone name to trigger mass outage
- ✅ **Zone-Preference Allocator**: Geographic dispatch preference
- ✅ **Side Strip Metrics**: Target vs Delivered, Online/Offline counts
- ✅ **Arb Windows Advisor**: HB_HUBAVG price windows on `/` and `/map`

## P2 Features (Not Implemented)

- ❌ Bill Stress Callouts
- ❌ Arm/Execute Arb Mode

---

## Vercel Deployment

Deploy from Origin (not GitHub) to Vercel.

### Project Configuration

| Setting | Value |
|---------|-------|
| Root Directory | `apps/web` |
| Framework Preset | Next.js |
| Build Command | `cd ../.. && pnpm install && pnpm build` |

### Environment Variables (Server-Only)

Add in Vercel Dashboard → Project Settings → Environment Variables:

| Variable | Required |
|----------|----------|
| `ERCOT_API_USERNAME` | No (optional for LIVE) |
| `ERCOT_API_PASSWORD` | No (optional for LIVE) |
| `ERCOT_PUBLIC_API_SUBSCRIPTION_KEY` | No (optional for LIVE) |

See [docs/vercel.md](docs/vercel.md) for complete deployment guide.

---

## Configuration

### Orchestrator Config

Default config (`packages/engine/src/types.ts`):

```typescript
{
  ackTimeoutMs: 5000,       // Timeout for command ACK
  maxRetries: 3,            // Maximum retry attempts
  freshnessThresholdMs: 30000, // Telemetry freshness
  commandExpiryMs: 60000,   // Command expiration
  tickIntervalMs: 1000,     // Simulation tick interval
  seed: 42,                 // Random seed for determinism
}
```

---

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/state` | GET | Get current simulation state |
| `/api/dispatch` | POST | Start a new dispatch `{targetKw}` |
| `/api/fault` | POST | Inject fault `{deviceId, faultType}` |
| `/api/fault?deviceId=X` | DELETE | Restore device |
| `/api/reset` | POST | Reset fleet `{seed?, deviceCount?}` |
| `/api/simulation` | POST | Control simulation `{action: 'start'|'stop'}` |
| `/api/ercot` | GET | Get ERCOT zone data and allocations |
| `/api/ercot-cache` | GET | Get cached ERCOT data with zone loads |
| `/api/ercot-prices` | GET | Get settlement point prices + arb windows |

---

## Technical Decisions

1. **SQLite for persistence**: Commands and events durable; hot path uses in-memory state with write-behind
2. **Seeded PRNG**: Mulberry32 algorithm for deterministic reproducible simulations
3. **Idempotency key format**: `{dispatchId}-{deviceId}-{epoch}-{sequence}` ensures uniqueness across reconnects
4. **Epoch increment on reconnect**: Invalidates all in-flight commands from before disconnect
5. **Check duplicate before stale**: Idempotency key check takes precedence over sequence check

---

## Remaining TODOs

- [ ] Persist processedKeys to SQLite (currently in-memory only)
- [ ] Add SOC drain simulation over time
- [ ] Implement delayed ACK fault type
- [ ] Add WebSocket for real-time updates instead of polling
- [ ] Load testing with 1000+ device fleet
- [ ] Add export/import of event log for analysis

---

## Stack

- **Monorepo**: pnpm workspaces
- **Engine**: Pure TypeScript, Vitest for testing
- **Web**: Next.js 14 App Router, React 18, Tailwind CSS
- **Database**: SQLite via better-sqlite3
- **Map**: Leaflet + react-leaflet + markercluster
- **ERCOT**: Live API (optional) or fixture fallback
- **No**: Kafka, K8s, auth, real batteries

---

**Built for Base Power × AITX Hackathon**  
Tracks: Orchestration + Open Grid Data
