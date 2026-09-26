# FleetFail ⚡ — Resilient Dispatch Simulator

> **Base Power × AITX Hackathon** — Orchestration + Open Grid Data Tracks
> 
> Deadline: Sunday 2026-09-27 10:00 AM America/Chicago

## ⚠️ SYNTHETIC DISCLAIMER

**This is NOT Base proprietary architecture.** All datasets, telemetry, and demo figures are **synthetic** unless a file explicitly states otherwise. Device positions are deterministically seeded for demonstration purposes.

### Fleet Map View

The `/map` page displays **~20,000 synthetic battery devices** across Texas (ERCOT) and Illinois (MISO) regions. **These markers represent synthetic zone clusters, NOT real Base installations.** Device positions are seeded around zone centroids.

**Fleet Distribution:**
- **Texas (ERCOT):** 70% of devices across 8 weather zones
- **Illinois (MISO):** 30% of devices across 4 load zones
- **Gen1 Devices:** 25kW / 50kWh (60% of fleet)
- **Gen3 Devices:** 40kW / 80kWh (40% of fleet)

**Map Features:**
- Leaflet.markercluster for efficient 20k device rendering
- Cluster aggregation at zoom-out, individual markers at zoom-in
- Viewport-based API serving (does not dump 20k per poll)

**Basemap**: OpenStreetMap (no API key required).

### Grid Data Sources

**ERCOT Live API (when credentials configured)**
- **Source:** ERCOT Public API (https://api.ercot.com/api/public-reports)
- **Auth:** OAuth2 ROPC flow via Azure B2C
- **Endpoints:**
  - `/np6-345-cd/act_sys_load_by_wzn` — Actual load by weather zone
  - `/np3-565-cd/lf_by_model_weather_zone` — Load forecast by weather zone
  - `/np4-742-cd/wpp_hrly_actual_fcast_geo` — Wind actual/forecast
  - `/np4-745-cd/spp_hrly_actual_fcast_geo` — Solar actual/forecast
- **Label:** "Cached / Replay (Live ERCOT <timestamp>)"
- **Caching:** 5-minute server-side TTL

**ERCOT Fixture (fallback when credentials not configured or API fails)**
- **Source:** ERCOT Grid Operations Dashboard (https://www.ercot.com/gridmktinfo/dashboards)
- **Capture:** September 2024 snapshot, afternoon peak period
- **Data:** Weather-zone load, wind/solar generation, temperature, net load
- **Label:** "Cached / Replay (Fixture Sep 2024)"

**Illinois Zones (Synthetic)**
- **Structure:** Based on MISO Zone 4/6 geography
- **Data:** Synthetic load values for demonstration

### Arb Windows (Settlement Point Prices)

**P0 Advisor — Wholesale SPP signals for charge/discharge window recommendations**

**ERCOT Price API (when credentials configured)**
- **RT SPP:** `/np6-905-cd/spp_node_zone_hub` — Real-time settlement point prices (15-min)
- **DAM SPP:** `/np4-190-cd/dam_stlmnt_pnt_prices` — Day-ahead settlement point prices (hourly)
- **Settlement Point:** `HB_HUBAVG` (ERCOT Hub Average) — configurable
- **Label:** "LIVE" badge when fetch succeeds
- **Caching:** 1-minute server-side TTL

**Window Algorithm:**
1. Over next 24 DAM hours, find argmin (charge window) and argmax (discharge window)
2. Require (discharge − charge) ≥ **$5/MWh** edge threshold
3. If spread < $5/MWh: show "no arb edge"

**Honesty Policy (stricter for prices):**
- Keys + fetch OK → **LIVE** badge
- Missing keys / fail → **"Unavailable"** (never invents SPP numbers)
- Wholesale SPP $/MWh — not a residential bill

**UI Display:**
- **Now $/MWh** — current RT settlement price
- **Charge Window** — best time to buy (lowest price)
- **Discharge Window** — best time to sell (highest price)
- **Spread** — $/MWh difference (green if ≥$5, warn if below threshold)

---

## Overview

FleetFail is a synthetic residential battery fleet orchestrator that proves aggregate dispatch recovers under partial failure **without**:
- Duplicate kW effects
- Stale command execution  
- Reserve violations

**Claim:** At-least-once delivery with idempotent effect (NOT exactly-once).

The system demonstrates that even with network partitions, lost ACKs, duplicate deliveries, and device reconnections, the fleet maintains invariants and the dispatch either converges or gracefully reports capacity shortfall.

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
│       │   └── zone-allocator.ts  # Zone-preference allocation
│       └── vitest.config.ts
├── apps/
│   └── web/             # Next.js App Router UI
│       ├── src/
│       │   ├── app/
│       │   │   ├── page.tsx       # Main dashboard
│       │   │   └── api/           # REST endpoints
│       │   └── lib/
│       │       └── orchestrator-state.ts
│       └── next.config.mjs
├── pnpm-workspace.yaml
└── package.json
```

## Key Concepts

### Units

| Unit | Description |
|------|-------------|
| **kW** | Power (rate of energy delivery). Used for dispatch targets and setpoints. |
| **kWh** | Energy (capacity). Used for battery storage capacity. |
| **SOC** | State of Charge (0-100%). Current battery level. |
| **Reserve** | Minimum SOC to maintain (default 20%). Prevents over-discharge. |
| **Freshness** | Maximum age of telemetry before considered stale (default 30s). |

### Domain Model

- **Device**: Battery unit with capacity, SOC, reserve, connection status, epoch, and processed idempotency keys
- **Command**: Dispatch instruction with absolute setpoint, idempotency_key, epoch/sequence, and expiry
- **Dispatch**: Aggregate target allocation tracking allocated vs delivered power
- **Event**: Audit log entry for all significant state changes

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

## P1 Features (Implemented)

- ✅ **20k Device Scale**: ~20,000 devices across Texas and Illinois with efficient in-memory management
- ✅ **TX + IL Geography**: 70% Texas (8 ERCOT zones), 30% Illinois (4 MISO zones)
- ✅ **Gen1/Gen3 Devices**: Gen1 (25kW/50kWh) and Gen3 (40kW/80kWh) battery generations
- ✅ **Map Clustering**: Leaflet.markercluster for 20k device rendering without 20k DOM markers
- ✅ **Viewport API**: `/api/state?minLat=...&maxLat=...&minLng=...&maxLng=...` returns only viewport devices
- ✅ **Real ERCOT Fixture**: Cached ERCOT data from September 2024 (documented source in `ercot-fixture.ts`)
- ✅ **Fleet Map View** (`/map`): Interactive Leaflet map with device clusters and individual markers at zoom-in
- ✅ **Click-to-Offline**: Click any device marker on the map to take it offline through the real fault/command path
- ✅ **Reallocation Visuals**: Devices receiving reallocated power pulse/glow with rising kW driven by real `REALLOCATED` and `COMMAND_ACKED` events
- ✅ **Zone Mass Outage**: Click zone name in side strip to trigger mass outage for that zone's devices
- ✅ **Zone-Preference Allocator**: Sort devices by zone weight for geographic dispatch preference
- ✅ **Side Strip Metrics**: Always-visible panel showing Target vs Delivered, Online/Offline counts, Device Summary

## P2 Features (Not Implemented)

- ❌ Bill Stress Callouts

## Configuration

### Environment Variables

Copy `.env.example` to `.env.local` and configure for live ERCOT data:

```bash
cp .env.example .env.local
```

| Variable | Description | Required |
|----------|-------------|----------|
| `ERCOT_API_USERNAME` | ERCOT B2C account email | For live data |
| `ERCOT_API_PASSWORD` | ERCOT B2C account password | For live data |
| `ERCOT_PUBLIC_API_SUBSCRIPTION_KEY` | Azure APIM subscription key | For live data |

**Without credentials:** System uses fixture data (Sep 2024 snapshot) — fully functional.  
**With credentials:** System fetches live ERCOT grid data with 5-minute cache TTL.

### Orchestrator Config

Default orchestrator config (`packages/engine/src/types.ts`):

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
| `/api/ercot-cache` | GET | Get cached ERCOT data with zone loads (labeled Cached / Replay) |
| `/api/ercot-prices` | GET | Get settlement point prices + arb windows (HB_HUBAVG default) |

## Demo Flow

### Ops Console (`/`)

1. Open UI at http://localhost:43210
2. Click "Start Dispatch" with 400 kW target
3. Watch devices receive commands and ACK
4. Click "Inject Mass Outage (10 devices)"
5. Observe:
   - `ACK_TIMEOUT` events for offline devices
   - `RETRY_SAME_ID` events with same idempotency key
   - `REALLOCATED` events moving power to available devices
   - `DEVICE_EXCLUDED` events for failed devices
6. Click "Restore All Devices"
7. Observe:
   - `DEVICE_RECONNECTED` events with new epochs
   - `STALE_REJECTED` events for old commands
   - Dispatch converges to target
8. Check metrics: duplicates ignored, stale rejected, reallocations all tracked

### Fleet Map View (`/map`)

1. Open http://localhost:43210/map or click "Fleet Map View" from ops console
2. View ~20,000 synthetic devices clustered across TX (ERCOT) and IL (MISO) regions
3. Map uses Leaflet.markercluster - zoom out to see clusters, zoom in to see individual devices
4. Start a 400kW dispatch from the side strip
5. **Zoom in and click a device marker** to take it offline (uses real fault/command path)
6. Observe:
   - Device turns red and offline on the map
   - `DEVICE_OFFLINE` event emitted
   - Surviving devices pulse/glow brighter (working harder)
   - Side strip shows rising `Reallocations` count
7. Click zone name in side strip to trigger mass outage for that zone
8. Side strip shows: Target vs Delivered, Online/Offline counts, Fleet summary by region
9. ERCOT banner shows "Cached / Replay (ERCOT Sep 2024)" with real cached zone load data

## Technical Decisions

1. **SQLite for persistence**: Commands and events durable, hot path uses in-memory state with write-behind
2. **Seeded PRNG**: Mulberry32 algorithm for deterministic reproducible simulations
3. **Idempotency key format**: `{dispatchId}-{deviceId}-{epoch}-{sequence}` ensures uniqueness across reconnects
4. **Epoch increment on reconnect**: Invalidates all in-flight commands from before disconnect
5. **Check duplicate before stale**: Idempotency key check takes precedence over sequence check

## Remaining TODOs

- [ ] Persist processedKeys to SQLite (currently in-memory only)
- [ ] Add SOC drain simulation over time
- [ ] Implement delayed ACK fault type
- [ ] Add WebSocket for real-time updates instead of polling
- [ ] Load testing with 1000+ device fleet
- [ ] Add export/import of event log for analysis

## Stack

- **Monorepo**: pnpm workspaces
- **Engine**: Pure TypeScript, Vitest for testing
- **Web**: Next.js 14 App Router, React 18, Tailwind CSS
- **Database**: SQLite via better-sqlite3
- **No**: Kafka, K8s, auth, live ERCOT, real batteries

---

**Built for Base Power × AITX Hackathon**  
Tracks: Orchestration + Open Grid Data
