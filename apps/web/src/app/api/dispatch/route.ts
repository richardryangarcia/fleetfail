import { NextResponse } from 'next/server';
import { getOrchestrator, startSimulation, getSimulationState } from '@/lib/orchestrator-state';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json();
  const targetKw = body.targetKw ?? 400;
  
  const orchestrator = getOrchestrator();
  const dispatch = orchestrator.startDispatch(targetKw);
  startSimulation();
  
  return NextResponse.json({
    dispatch,
    state: getSimulationState(),
  });
}
