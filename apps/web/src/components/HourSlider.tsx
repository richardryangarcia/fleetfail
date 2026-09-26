'use client';

import { useMemo } from 'react';
import type { ErcotHourlySnapshot } from '@fleetfail/engine';

interface HourSliderProps {
  hourlyData: ErcotHourlySnapshot[];
  currentHourKey: string;
  selectedHourKey: string;
  onHourChange: (hourKey: string) => void;
}

function formatHourLabel(hourKey: string): string {
  const [, time] = hourKey.split(' ');
  const hour = parseInt(time?.split(':')[0] || '0', 10);
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  if (hour < 12) return `${hour}a`;
  return `${hour - 12}p`;
}

function formatDateLabel(hourKey: string): string {
  const [date] = hourKey.split(' ');
  const [, month, day] = (date || '').split('-');
  return `${parseInt(month || '1', 10)}/${parseInt(day || '1', 10)}`;
}

export function HourSlider({ hourlyData, currentHourKey, selectedHourKey, onHourChange }: HourSliderProps) {
  const sortedHours = useMemo(() => {
    return [...hourlyData].sort((a, b) => a.hourKey.localeCompare(b.hourKey));
  }, [hourlyData]);
  
  const selectedIndex = useMemo(() => {
    return sortedHours.findIndex(h => h.hourKey === selectedHourKey);
  }, [sortedHours, selectedHourKey]);
  
  const currentIndex = useMemo(() => {
    return sortedHours.findIndex(h => h.hourKey === currentHourKey);
  }, [sortedHours, currentHourKey]);
  
  const selectedSnapshot = sortedHours[selectedIndex];
  const isActual = selectedSnapshot?.dataType === 'actual';
  
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const index = parseInt(e.target.value, 10);
    const hour = sortedHours[index];
    if (hour) {
      onHourChange(hour.hourKey);
    }
  };
  
  const handleStepBack = () => {
    if (selectedIndex > 0) {
      const prevHour = sortedHours[selectedIndex - 1];
      if (prevHour) {
        onHourChange(prevHour.hourKey);
      }
    }
  };
  
  const handleStepForward = () => {
    if (selectedIndex < sortedHours.length - 1) {
      const nextHour = sortedHours[selectedIndex + 1];
      if (nextHour) {
        onHourChange(nextHour.hourKey);
      }
    }
  };
  
  const handleGoToNow = () => {
    if (currentIndex >= 0) {
      const nowHour = sortedHours[currentIndex];
      if (nowHour) {
        onHourChange(nowHour.hourKey);
      }
    }
  };
  
  if (sortedHours.length === 0) {
    return null;
  }
  
  const firstDate = formatDateLabel(sortedHours[0]?.hourKey || '');
  const lastDate = formatDateLabel(sortedHours[sortedHours.length - 1]?.hourKey || '');
  const showDateRange = firstDate !== lastDate;
  
  return (
    <div className="bg-[#0c0e12] border border-nc-line-strong px-3 py-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[9px] tracking-widest uppercase text-nc-ink-mute font-bold">
            Hour Selection
          </span>
          <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 border ${
            isActual 
              ? 'text-nc-ok border-[#1e4a32] bg-[#0a1810]' 
              : 'text-nc-accent border-nc-accent-dim bg-[#161208]'
          }`}>
            {isActual ? 'ACTUAL' : 'FORECAST'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-nc-num">
            {formatHourLabel(selectedHourKey)}
          </span>
          {selectedIndex !== currentIndex && currentIndex >= 0 && (
            <button
              onClick={handleGoToNow}
              className="text-[10px] font-mono text-nc-accent hover:text-nc-accent-dim cursor-pointer bg-transparent border-none"
            >
              → now
            </button>
          )}
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        <button
          onClick={handleStepBack}
          disabled={selectedIndex <= 0}
          className="w-6 h-6 flex items-center justify-center border border-nc-line-strong text-nc-ink-dim hover:text-nc-ink hover:border-nc-ink-mute disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer bg-nc-panel"
          title="Previous hour"
        >
          ‹
        </button>
        
        <div className="flex-1 relative">
          <input
            type="range"
            min={0}
            max={sortedHours.length - 1}
            value={selectedIndex >= 0 ? selectedIndex : 0}
            onChange={handleSliderChange}
            className="w-full h-2 appearance-none cursor-pointer bg-nc-line-strong rounded-sm
              [&::-webkit-slider-thumb]:appearance-none
              [&::-webkit-slider-thumb]:w-3
              [&::-webkit-slider-thumb]:h-4
              [&::-webkit-slider-thumb]:bg-nc-num
              [&::-webkit-slider-thumb]:border
              [&::-webkit-slider-thumb]:border-nc-ink-mute
              [&::-webkit-slider-thumb]:cursor-pointer
              [&::-moz-range-thumb]:w-3
              [&::-moz-range-thumb]:h-4
              [&::-moz-range-thumb]:bg-nc-num
              [&::-moz-range-thumb]:border
              [&::-moz-range-thumb]:border-nc-ink-mute
              [&::-moz-range-thumb]:cursor-pointer"
          />
          
          {currentIndex >= 0 && currentIndex !== selectedIndex && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-nc-accent pointer-events-none"
              style={{
                left: `${(currentIndex / Math.max(1, sortedHours.length - 1)) * 100}%`,
              }}
              title="Now"
            />
          )}
        </div>
        
        <button
          onClick={handleStepForward}
          disabled={selectedIndex >= sortedHours.length - 1}
          className="w-6 h-6 flex items-center justify-center border border-nc-line-strong text-nc-ink-dim hover:text-nc-ink hover:border-nc-ink-mute disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer bg-nc-panel"
          title="Next hour"
        >
          ›
        </button>
      </div>
      
      <div className="flex justify-between mt-1 text-[9px] font-mono text-nc-ink-mute">
        <span>{showDateRange ? `${firstDate} ` : ''}{formatHourLabel(sortedHours[0]?.hourKey || '')}</span>
        <span>{showDateRange ? `${lastDate} ` : ''}{formatHourLabel(sortedHours[sortedHours.length - 1]?.hourKey || '')}</span>
      </div>
    </div>
  );
}
