import { NextResponse } from 'next/server';
import { getOrchestrator, getSimulationState } from '@/lib/orchestrator-state';
import type { FaultType } from '@fleetfail/engine';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json();
  const { deviceId, faultType, durationMs } = body;
  
  if (!deviceId || !faultType) {
    return NextResponse.json({ error: 'deviceId and faultType required' }, { status: 400 });
  }
  
  const orchestrator = getOrchestrator();
  const fault = orchestrator.injectFault({
    deviceId,
    faultType: faultType as FaultType,
    durationMs,
  });
  
  return NextResponse.json({
    fault,
    state: getSimulationState(),
  });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const deviceId = searchParams.get('deviceId');
  
  if (!deviceId) {
    return NextResponse.json({ error: 'deviceId required' }, { status: 400 });
  }
  
  const orchestrator = getOrchestrator();
  orchestrator.restoreDevice(deviceId);
  
  return NextResponse.json({
    restored: deviceId,
    state: getSimulationState(),
  });
}
