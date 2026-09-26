import { NextResponse } from 'next/server';
import { getSimulationState } from '@/lib/orchestrator-state';
import type { Device } from '@fleetfail/engine';

export const dynamic = 'force-dynamic';

interface ViewportBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

function filterDevicesByViewport(devices: Device[], bounds: ViewportBounds): Device[] {
  return devices.filter(d =>
    d.latitude >= bounds.minLat &&
    d.latitude <= bounds.maxLat &&
    d.longitude >= bounds.minLng &&
    d.longitude <= bounds.maxLng
  );
}

function getDeviceSummary(devices: Device[]) {
  return {
    total: devices.length,
    online: devices.filter(d => d.status === 'online').length,
    offline: devices.filter(d => d.status === 'offline').length,
    byRegion: {
      TX: devices.filter(d => d.region === 'TX').length,
      IL: devices.filter(d => d.region === 'IL').length,
    },
    byGeneration: {
      gen1: devices.filter(d => d.generation === 'gen1').length,
      gen3: devices.filter(d => d.generation === 'gen3').length,
    },
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  
  const minLat = searchParams.get('minLat');
  const maxLat = searchParams.get('maxLat');
  const minLng = searchParams.get('minLng');
  const maxLng = searchParams.get('maxLng');
  
  const state = getSimulationState();
  
  const hasViewport = minLat && maxLat && minLng && maxLng;
  
  if (hasViewport) {
    const bounds: ViewportBounds = {
      minLat: parseFloat(minLat),
      maxLat: parseFloat(maxLat),
      minLng: parseFloat(minLng),
      maxLng: parseFloat(maxLng),
    };
    
    const viewportDevices = filterDevicesByViewport(state.devices, bounds);
    
    return NextResponse.json({
      ...state,
      devices: viewportDevices,
      deviceSummary: getDeviceSummary(state.devices),
      viewportDeviceCount: viewportDevices.length,
      totalDeviceCount: state.devices.length,
    });
  }
  
  return NextResponse.json({
    ...state,
    deviceSummary: getDeviceSummary(state.devices),
    totalDeviceCount: state.devices.length,
  });
}
