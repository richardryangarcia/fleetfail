# FleetFail ⚡ — Resilient Dispatch Simulator

> **Base Power × AITX Hackathon** — Orchestration + Open Grid Data Tracks
> 
> Deadline: Sunday 2026-09-27 10:00 AM America/Chicago

## ⚠️ SYNTHETIC DISCLAIMER

**This is NOT Base proprietary architecture.** All datasets, telemetry, and demo figures are **synthetic** unless a file explicitly states otherwise. The ERCOT zone data, device characteristics, and grid metrics are fabricated for demonstration purposes only.

### Texas Map View

The `/map` page displays ~50-100 synthetic battery devices clustered by ERCOT weather zone. **These markers represent synthetic zone clusters, NOT real Base installations.** Device positions are deterministically seeded around zone centroids for demonstration purposes.

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

- ✅ **ERCOT Weather Zone Fixture**: Synthetic zone data with net load, temperature, wind/solar generation
- ✅ **Zone-Preference Allocator**: Sort devices by zone weight for geographic dispatch preference
- ✅ **Zone Activity Map**: Visual indicator of event activity by zone from event log
- ✅ **Texas Map View** (`/map`): Interactive Leaflet map with ~50-100 devices clustered by ERCOT weather zone
- ✅ **Click-to-Offline**: Click any device marker on the map to take it offline through the real fault/command path
- ✅ **Reallocation Visuals**: Devices receiving reallocated power pulse/glow with rising kW driven by real `REALLOCATED` and `COMMAND_ACKED` events
- ✅ **Zone Mass Outage**: Click zone name in side strip to trigger mass outage for that zone's devices
- ✅ **ERCOT Cache**: Cached real ERCOT weather-zone load + wind/solar net-load outlook with "Cached / Replay" label
- ✅ **Side Strip Metrics**: Always-visible panel showing Target vs Delivered, Online/Offline counts, Duplicates Ignored, Stale Rejected

## P2 Features (Not Implemented)

- ❌ Bill Stress Callouts

## Configuration

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

### Texas Map View (`/map`)

1. Open http://localhost:43210/map or click "Texas Map View" from ops console
2. View ~50-100 synthetic devices clustered by ERCOT weather zone on the Texas map
3. Start a 400kW dispatch from the side strip
4. **Click a battery marker** to take that device offline (uses real fault/command path)
5. Observe:
   - Device turns red and offline on the map
   - `DEVICE_OFFLINE` event emitted
   - Surviving devices pulse/glow brighter (working harder)
   - Side strip shows rising `Reallocations` count
6. Click zone name in side strip to trigger mass outage for that zone
7. Side strip always shows: Target vs Delivered, Online/Offline, Duplicates Ignored, Stale Rejected
8. ERCOT banner shows "Cached / Replay" label with cached zone load data

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
