import { useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ZoomChip } from '../../ZoomChip';
import { Block } from '../layout';

const LEVELS = [0.9, 1, 1.1, 1.5];

export function ZoomChipBlock() {
  const [zoom, setZoom] = useState(1.1);
  return (
    <Block
      title="Zoom chip"
      use="Top centre while the app zoom (⌘+ / ⌘−) is off 100%. Click resets. Pick a level to see it enter and leave."
    >
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={String(zoom)}
        onValueChange={(v) => v && setZoom(Number(v))}
        aria-label="Zoom level"
      >
        {LEVELS.map((level) => (
          <ToggleGroupItem
            key={level}
            value={String(level)}
            className="tabular-nums"
          >
            {Math.round(level * 100)}%
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div className="relative h-32 overflow-hidden rounded-xl border bg-background">
        <div className="h-11 bg-background" />
        <ZoomChip
          zoom={zoom}
          onReset={() => setZoom(1)}
          className="absolute inset-x-0 top-2"
        />
      </div>
    </Block>
  );
}
