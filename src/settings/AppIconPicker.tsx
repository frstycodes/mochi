import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { APP_ICONS } from './settingOptions';

export function AppIconPicker({ id, value, onChange }: { id: string; value: string; onChange: (icon: string) => void }) {
  return (
    <ToggleGroup id={id} type="single" variant="outline" spacing={2} value={value} onValueChange={(icon) => icon && onChange(icon)} className="grid w-full grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))]">
      {APP_ICONS.map((icon) => (
        <ToggleGroupItem key={icon.value} value={icon.value} className="h-auto flex-col gap-1 rounded-xl px-2 pt-2 pb-1.5 type-meta">
          <img src={ICON_URLS[`../../build/icons/${icon.value}.svg`]} alt="" className="size-14" />
          {icon.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const ICON_URLS = import.meta.glob<string>('../../build/icons/*.svg', { query: '?url', import: 'default', eager: true });
