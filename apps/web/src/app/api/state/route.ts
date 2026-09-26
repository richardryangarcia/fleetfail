import { NextResponse } from 'next/server';
import { getSimulationState } from '@/lib/orchestrator-state';

export const dynamic = 'force-dynamic';

export async function GET() {
  const state = getSimulationState();
  return NextResponse.json(state);
}
