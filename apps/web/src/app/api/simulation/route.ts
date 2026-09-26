import { NextResponse } from 'next/server';
import { startSimulation, stopSimulation, isSimulationRunning, getSimulationState } from '@/lib/orchestrator-state';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json();
  const action = body.action;
  
  if (action === 'start') {
    startSimulation();
  } else if (action === 'stop') {
    stopSimulation();
  }
  
  return NextResponse.json({
    isRunning: isSimulationRunning(),
    state: getSimulationState(),
  });
}
