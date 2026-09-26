import { NextResponse } from 'next/server';
import { ERCOT_ZONES, getGridStatus, getZoneAllocations } from '@fleetfail/engine';
import { getOrchestrator } from '@/lib/orchestrator-state';

export const dynamic = 'force-dynamic';

export async function GET() {
  const orchestrator = getOrchestrator();
  const devices = orchestrator.getDevices();
  const zoneAllocations = getZoneAllocations(devices);
  const gridStatus = getGridStatus();
  
  return NextResponse.json({
    zones: ERCOT_ZONES,
    zoneAllocations,
    gridStatus,
  });
}
