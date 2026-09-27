import { NextResponse } from 'next/server';
import type { ArbWindow, PriceCacheData } from '@fleetfail/engine';
import { 
  armArbMode, 
  disarmArbMode, 
  getArbModeState,
  executeArbDispatch,
  getSimulationState 
} from '@/lib/orchestrator-state';

export const dynamic = 'force-dynamic';

interface ArmArbRequest {
  action: 'arm';
  chargeWindow: ArbWindow | null;
  dischargeWindow: ArbWindow | null;
  spreadMwh: number;
}

interface DisarmArbRequest {
  action: 'disarm';
}

interface ExecuteArbRequest {
  action: 'execute';
  targetKw: number;
  windowType: 'charge' | 'discharge';
  priceMwh: number;
  hourEnding: number;
}

type ArbRequest = ArmArbRequest | DisarmArbRequest | ExecuteArbRequest;

export async function GET() {
  return NextResponse.json({
    arbMode: getArbModeState(),
  });
}

export async function POST(request: Request) {
  const body = await request.json() as ArbRequest;
  
  if (body.action === 'arm') {
    const arbState = armArbMode(
      body.chargeWindow,
      body.dischargeWindow,
      body.spreadMwh
    );
    return NextResponse.json({
      success: true,
      arbMode: arbState,
      state: getSimulationState(),
    });
  }
  
  if (body.action === 'disarm') {
    const arbState = disarmArbMode();
    return NextResponse.json({
      success: true,
      arbMode: arbState,
      state: getSimulationState(),
    });
  }
  
  if (body.action === 'execute') {
    const dispatch = executeArbDispatch(
      body.targetKw,
      body.windowType,
      body.priceMwh,
      body.hourEnding
    );
    return NextResponse.json({
      success: true,
      dispatch,
      arbMode: getArbModeState(),
      state: getSimulationState(),
    });
  }
  
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
