import Database from 'better-sqlite3';
import type { Command, Dispatch, FleetEvent, Device, DeviceRegion, DeviceGeneration } from './types.js';
import type { ErcotCacheData, ErcotDataSource } from './ercot-cache.js';
import type { PriceCacheData } from './ercot-prices.js';

export interface DbConfig {
  path: string;
  inMemory?: boolean;
}

export type ErcotSnapshotType = 'grid' | 'prices';

export class FleetDb {
  private db: Database.Database;
  private writeQueue: Array<() => void> = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: DbConfig = { path: ':memory:', inMemory: true }) {
    this.db = new Database(config.inMemory ? ':memory:' : config.path);
    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        max_power_kw REAL NOT NULL,
        capacity_kwh REAL NOT NULL,
        soc_percent REAL NOT NULL,
        reserve_percent REAL NOT NULL,
        status TEXT NOT NULL,
        last_telemetry_at INTEGER NOT NULL,
        epoch INTEGER NOT NULL,
        last_sequence INTEGER NOT NULL,
        processed_keys TEXT NOT NULL,
        zone TEXT NOT NULL,
        latitude REAL NOT NULL DEFAULT 31.0,
        longitude REAL NOT NULL DEFAULT -99.0,
        current_setpoint_kw REAL NOT NULL DEFAULT 0,
        region TEXT NOT NULL DEFAULT 'TX',
        generation TEXT NOT NULL DEFAULT 'gen1'
      );

      CREATE TABLE IF NOT EXISTS commands (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL,
        device_id TEXT NOT NULL,
        dispatch_id TEXT NOT NULL,
        setpoint_kw REAL NOT NULL,
        epoch INTEGER NOT NULL,
        sequence INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL,
        last_attempt_at INTEGER,
        acked_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_commands_dispatch ON commands(dispatch_id);
      CREATE INDEX IF NOT EXISTS idx_commands_device ON commands(device_id);
      CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_commands_idempotency ON commands(idempotency_key);

      CREATE TABLE IF NOT EXISTS dispatches (
        id TEXT PRIMARY KEY,
        target_kw REAL NOT NULL,
        allocated_kw REAL NOT NULL,
        delivered_kw REAL NOT NULL,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        status TEXT NOT NULL,
        command_ids TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        dispatch_id TEXT,
        device_id TEXT,
        command_id TEXT,
        details TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_dispatch ON events(dispatch_id);

      -- ERCOT last-good snapshots: stores successfully fetched live data
      -- for fallback when live API is rate-limited or unavailable
      -- For 'grid' type, cache_key is just 'grid'
      -- For 'prices' type, cache_key is 'prices:{settlementPoint}'
      CREATE TABLE IF NOT EXISTS ercot_last_good (
        cache_key TEXT PRIMARY KEY,
        type TEXT NOT NULL,     -- 'grid' or 'prices'
        data TEXT NOT NULL,     -- JSON-serialized ErcotCacheData or PriceCacheData
        captured_at INTEGER NOT NULL
      );
    `);
  }

  saveDevice(device: Device): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO devices (
        id, name, max_power_kw, capacity_kwh, soc_percent, reserve_percent,
        status, last_telemetry_at, epoch, last_sequence, processed_keys, zone,
        latitude, longitude, current_setpoint_kw, region, generation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      device.id,
      device.name,
      device.maxPowerKw,
      device.capacityKwh,
      device.socPercent,
      device.reservePercent,
      device.status,
      device.lastTelemetryAt,
      device.epoch,
      device.lastSequence,
      JSON.stringify(Array.from(device.processedKeys)),
      device.zone,
      device.latitude,
      device.longitude,
      device.currentSetpointKw,
      device.region,
      device.generation
    );
  }

  saveDevices(devices: Device[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO devices (
        id, name, max_power_kw, capacity_kwh, soc_percent, reserve_percent,
        status, last_telemetry_at, epoch, last_sequence, processed_keys, zone,
        latitude, longitude, current_setpoint_kw, region, generation
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insert = this.db.transaction((devices: Device[]) => {
      for (const device of devices) {
        stmt.run(
          device.id,
          device.name,
          device.maxPowerKw,
          device.capacityKwh,
          device.socPercent,
          device.reservePercent,
          device.status,
          device.lastTelemetryAt,
          device.epoch,
          device.lastSequence,
          JSON.stringify(Array.from(device.processedKeys)),
          device.zone,
          device.latitude,
          device.longitude,
          device.currentSetpointKw,
          device.region,
          device.generation
        );
      }
    });
    
    insert(devices);
  }

  loadDevices(): Device[] {
    const rows = this.db.prepare('SELECT * FROM devices').all() as Array<{
      id: string;
      name: string;
      max_power_kw: number;
      capacity_kwh: number;
      soc_percent: number;
      reserve_percent: number;
      status: string;
      last_telemetry_at: number;
      epoch: number;
      last_sequence: number;
      processed_keys: string;
      zone: string;
      latitude: number;
      longitude: number;
      current_setpoint_kw: number;
      region: string;
      generation: string;
    }>;
    
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      maxPowerKw: row.max_power_kw,
      capacityKwh: row.capacity_kwh,
      socPercent: row.soc_percent,
      reservePercent: row.reserve_percent,
      status: row.status as Device['status'],
      lastTelemetryAt: row.last_telemetry_at,
      epoch: row.epoch,
      lastSequence: row.last_sequence,
      processedKeys: new Set(JSON.parse(row.processed_keys)),
      zone: row.zone,
      latitude: row.latitude,
      longitude: row.longitude,
      currentSetpointKw: row.current_setpoint_kw,
      region: row.region as DeviceRegion,
      generation: row.generation as DeviceGeneration,
    }));
  }

  saveCommand(command: Command): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO commands (
        id, idempotency_key, device_id, dispatch_id, setpoint_kw,
        epoch, sequence, expires_at, created_at, status,
        attempt_count, last_attempt_at, acked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      command.id,
      command.idempotencyKey,
      command.deviceId,
      command.dispatchId,
      command.setpointKw,
      command.epoch,
      command.sequence,
      command.expiresAt,
      command.createdAt,
      command.status,
      command.attemptCount,
      command.lastAttemptAt,
      command.ackedAt
    );
  }

  saveCommands(commands: Command[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO commands (
        id, idempotency_key, device_id, dispatch_id, setpoint_kw,
        epoch, sequence, expires_at, created_at, status,
        attempt_count, last_attempt_at, acked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insert = this.db.transaction((commands: Command[]) => {
      for (const command of commands) {
        stmt.run(
          command.id,
          command.idempotencyKey,
          command.deviceId,
          command.dispatchId,
          command.setpointKw,
          command.epoch,
          command.sequence,
          command.expiresAt,
          command.createdAt,
          command.status,
          command.attemptCount,
          command.lastAttemptAt,
          command.ackedAt
        );
      }
    });
    
    insert(commands);
  }

  loadCommands(): Command[] {
    const rows = this.db.prepare('SELECT * FROM commands').all() as Array<{
      id: string;
      idempotency_key: string;
      device_id: string;
      dispatch_id: string;
      setpoint_kw: number;
      epoch: number;
      sequence: number;
      expires_at: number;
      created_at: number;
      status: string;
      attempt_count: number;
      last_attempt_at: number | null;
      acked_at: number | null;
    }>;
    
    return rows.map(row => ({
      id: row.id,
      idempotencyKey: row.idempotency_key,
      deviceId: row.device_id,
      dispatchId: row.dispatch_id,
      setpointKw: row.setpoint_kw,
      epoch: row.epoch,
      sequence: row.sequence,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      status: row.status as Command['status'],
      attemptCount: row.attempt_count,
      lastAttemptAt: row.last_attempt_at,
      ackedAt: row.acked_at,
    }));
  }

  saveDispatch(dispatch: Dispatch): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO dispatches (
        id, target_kw, allocated_kw, delivered_kw, created_at,
        completed_at, status, command_ids
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      dispatch.id,
      dispatch.targetKw,
      dispatch.allocatedKw,
      dispatch.deliveredKw,
      dispatch.createdAt,
      dispatch.completedAt,
      dispatch.status,
      JSON.stringify(dispatch.commandIds)
    );
  }

  loadDispatches(): Dispatch[] {
    const rows = this.db.prepare('SELECT * FROM dispatches').all() as Array<{
      id: string;
      target_kw: number;
      allocated_kw: number;
      delivered_kw: number;
      created_at: number;
      completed_at: number | null;
      status: string;
      command_ids: string;
    }>;
    
    return rows.map(row => ({
      id: row.id,
      targetKw: row.target_kw,
      allocatedKw: row.allocated_kw,
      deliveredKw: row.delivered_kw,
      createdAt: row.created_at,
      completedAt: row.completed_at,
      status: row.status as Dispatch['status'],
      commandIds: JSON.parse(row.command_ids),
    }));
  }

  saveEvent(event: FleetEvent): void {
    const stmt = this.db.prepare(`
      INSERT INTO events (
        id, type, timestamp, dispatch_id, device_id, command_id, details
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      event.id,
      event.type,
      event.timestamp,
      event.dispatchId,
      event.deviceId,
      event.commandId,
      JSON.stringify(event.details)
    );
  }

  saveEvents(evts: FleetEvent[]): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO events (
        id, type, timestamp, dispatch_id, device_id, command_id, details
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insert = this.db.transaction((evts: FleetEvent[]) => {
      for (const event of evts) {
        stmt.run(
          event.id,
          event.type,
          event.timestamp,
          event.dispatchId,
          event.deviceId,
          event.commandId,
          JSON.stringify(event.details)
        );
      }
    });
    
    insert(evts);
  }

  loadEvents(limit?: number): FleetEvent[] {
    const query = limit
      ? 'SELECT * FROM events ORDER BY timestamp ASC LIMIT ?'
      : 'SELECT * FROM events ORDER BY timestamp ASC';
    
    const rows = (limit
      ? this.db.prepare(query).all(limit)
      : this.db.prepare(query).all()) as Array<{
      id: string;
      type: string;
      timestamp: number;
      dispatch_id: string | null;
      device_id: string | null;
      command_id: string | null;
      details: string;
    }>;
    
    return rows.map(row => ({
      id: row.id,
      type: row.type as FleetEvent['type'],
      timestamp: row.timestamp,
      dispatchId: row.dispatch_id,
      deviceId: row.device_id,
      commandId: row.command_id,
      details: JSON.parse(row.details),
    }));
  }

  getRecentEvents(count: number): FleetEvent[] {
    const rows = this.db.prepare(`
      SELECT * FROM events ORDER BY timestamp DESC LIMIT ?
    `).all(count) as Array<{
      id: string;
      type: string;
      timestamp: number;
      dispatch_id: string | null;
      device_id: string | null;
      command_id: string | null;
      details: string;
    }>;
    
    return rows.reverse().map(row => ({
      id: row.id,
      type: row.type as FleetEvent['type'],
      timestamp: row.timestamp,
      dispatchId: row.dispatch_id,
      deviceId: row.device_id,
      commandId: row.command_id,
      details: JSON.parse(row.details),
    }));
  }

  /**
   * Cache key version - bump this when hourlyData shape changes to bust stale cache.
   * v2: Fixed PascalCase→camelCase field mapping, 72h forecast, proper currentHourKey selection.
   */
  private static readonly CACHE_KEY_VERSION = 'v2';

  /**
   * Save last-good ERCOT grid data snapshot.
   * Called on successful live fetch to preserve for fallback.
   */
  saveLastGoodGrid(data: ErcotCacheData): void {
    const cacheKey = `grid:${FleetDb.CACHE_KEY_VERSION}`;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ercot_last_good (cache_key, type, data, captured_at)
      VALUES (?, 'grid', ?, ?)
    `);
    stmt.run(cacheKey, JSON.stringify(data), Date.now());
  }

  /**
   * Load last-good ERCOT grid data snapshot.
   * Returns null if no snapshot exists.
   */
  loadLastGoodGrid(): ErcotCacheData | null {
    const cacheKey = `grid:${FleetDb.CACHE_KEY_VERSION}`;
    const row = this.db.prepare(`
      SELECT data, captured_at FROM ercot_last_good WHERE cache_key = ?
    `).get(cacheKey) as { data: string; captured_at: number } | undefined;
    
    if (!row) return null;
    
    const parsed = JSON.parse(row.data) as ErcotCacheData;
    return {
      ...parsed,
      dataSource: 'cached' as ErcotDataSource,
      cacheLabel: 'Cached / Replay — Live ERCOT unavailable',
    };
  }

  /**
   * Save last-good ERCOT price data snapshot.
   * Called on successful live fetch to preserve for fallback.
   * Each settlement point is stored separately.
   */
  saveLastGoodPrices(data: PriceCacheData): void {
    const cacheKey = `prices:${FleetDb.CACHE_KEY_VERSION}:${data.settlementPoint}`;
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ercot_last_good (cache_key, type, data, captured_at)
      VALUES (?, 'prices', ?, ?)
    `);
    stmt.run(cacheKey, JSON.stringify(data), Date.now());
  }

  /**
   * Load last-good ERCOT price data snapshot.
   * Returns null if no snapshot exists for the given settlement point.
   */
  loadLastGoodPrices(settlementPoint: string): PriceCacheData | null {
    const cacheKey = `prices:${FleetDb.CACHE_KEY_VERSION}:${settlementPoint}`;
    const row = this.db.prepare(`
      SELECT data, captured_at FROM ercot_last_good WHERE cache_key = ?
    `).get(cacheKey) as { data: string; captured_at: number } | undefined;
    
    if (!row) return null;
    
    const parsed = JSON.parse(row.data) as PriceCacheData;
    return {
      ...parsed,
      dataSource: 'cached' as ErcotDataSource,
    };
  }

  /**
   * Check if we have a last-good snapshot available.
   */
  hasLastGoodGrid(): boolean {
    const cacheKey = `grid:${FleetDb.CACHE_KEY_VERSION}`;
    const row = this.db.prepare(`
      SELECT 1 FROM ercot_last_good WHERE cache_key = ?
    `).get(cacheKey);
    return !!row;
  }

  /**
   * Check if we have last-good price data for a settlement point.
   */
  hasLastGoodPrices(settlementPoint: string): boolean {
    const cacheKey = `prices:${FleetDb.CACHE_KEY_VERSION}:${settlementPoint}`;
    const row = this.db.prepare(`
      SELECT 1 FROM ercot_last_good WHERE cache_key = ?
    `).get(cacheKey);
    return !!row;
  }

  queueWrite(fn: () => void): void {
    this.writeQueue.push(fn);
  }

  flush(): void {
    if (this.writeQueue.length === 0) return;
    
    const queue = [...this.writeQueue];
    this.writeQueue = [];
    
    this.db.transaction(() => {
      for (const fn of queue) {
        fn();
      }
    })();
  }

  startWriteBehind(intervalMs: number = 100): void {
    if (this.flushInterval) return;
    this.flushInterval = setInterval(() => this.flush(), intervalMs);
  }

  stopWriteBehind(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
  }

  clear(): void {
    this.db.exec(`
      DELETE FROM events;
      DELETE FROM commands;
      DELETE FROM dispatches;
      DELETE FROM devices;
      DELETE FROM ercot_last_good;
    `);
  }

  close(): void {
    this.stopWriteBehind();
    this.db.close();
  }
}
