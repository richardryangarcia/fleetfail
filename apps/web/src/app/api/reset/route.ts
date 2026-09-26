import { NextResponse } from 'next/server';
import { resetOrchestrator, getSimulationState } from '@/lib/orchestrator-state';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const seed = body.seed;
  const deviceCount = body.deviceCount ?? 50;
  
  resetOrchestrator(seed, deviceCount);
  
  return NextResponse.json({
    state: getSimulationState(),
  });
}
