import { useState, type ReactNode } from 'react';
import { ChevronDown } from '@/icons';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { SystemFont } from '../host/types/settings.ts';
import {
  fontStack,
  isMissingFont,
  setFontPreview,
  useSystemFonts,
} from './fonts.ts';
import { settingControlId } from './parts';
import {
  DEFAULT_FONT_LABEL,
  SYSTEM_FONT,
  SYSTEM_FONT_LABEL,
  type FontKind,
} from './settingOptions.ts';

/**
 * Picks the interface or code font: search, the default, then installed families (monospace ones for code), each in its
 * own face; a typed name the list lacks can be used as is. The highlighted family previews app-wide until it closes.
 */
export function FontPicker({
  id,
  kind,
  value,
  onChange,
}: {
  id: string;
  kind: FontKind;
  value: string;
  onChange: (family: string) => void;
}) {
  const [isOpen, setOpen] = useState(false);
  const toggle = (next: boolean) => {
    setOpen(next);
    if (!next) setFontPreview(kind, undefined);
  };
  const pick = (family: string) => {
    onChange(family);
    toggle(false);
  };
  return (
    <Popover open={isOpen} onOpenChange={toggle}>
      <PopoverTrigger asChild>
        <Button
          id={settingControlId(id)}
          variant="outline"
          size="sm"
          className="w-56 justify-start"
        >
          <span
            className="min-w-0 flex-1 truncate text-left"
            style={{ fontFamily: fontStack(kind, value) }}
          >
            {value === SYSTEM_FONT[kind]
              ? SYSTEM_FONT_LABEL[kind]
              : value || DEFAULT_FONT_LABEL[kind]}
          </span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        <FontList kind={kind} value={value} onPick={pick} />
      </PopoverContent>
    </Popover>
  );
}

/** A font row's description, or why its family won't show; the same slot, so the row never grows. */
export function FontNote({
  kind,
  family,
  children,
}: {
  kind: FontKind;
  family: string;
  children: ReactNode;
}) {
  const fonts = useSystemFonts();
  if (!isMissingFont(family, fonts)) return children;
  return (
    <span className="text-warning">
      “{family}” isn't installed, so {DEFAULT_FONT_LABEL[kind]} shows instead
    </span>
  );
}

// cmdk needs a non-empty value per item, and a typed name could match a listed family in another case.
const DEFAULT_VALUE = 'default:';
const SYSTEM_VALUE = 'system:';
const CUSTOM_PREFIX = 'custom:';

function FontList({
  kind,
  value,
  onPick,
}: {
  kind: FontKind;
  value: string;
  onPick: (family: string) => void;
}) {
  const fonts = useSystemFonts();
  const installed = familiesFor(kind, fonts);
  const [search, setSearch] = useState('');
  // Controlled: cmdk reports the highlighted item only then, and the list opens on the font in use.
  const [highlighted, setHighlighted] = useState(
    value === SYSTEM_FONT[kind] ? SYSTEM_VALUE : value || DEFAULT_VALUE,
  );
  const highlight = (next: string) => {
    setHighlighted(next);
    setFontPreview(kind, familyOf(kind, next));
  };
  const typed = search.trim();
  const isListed = [
    DEFAULT_FONT_LABEL[kind],
    SYSTEM_FONT_LABEL[kind],
    ...installed,
  ].some((family) => family.toLowerCase() === typed.toLowerCase());
  const isSavedListed =
    !value || value === SYSTEM_FONT[kind] || installed.includes(value);
  return (
    <Command value={highlighted} onValueChange={highlight}>
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder={
          kind === 'ui'
            ? 'Search or type a font name'
            : 'Search or type a code font'
        }
      />
      <CommandList className="max-h-80">
        <CommandEmpty>No installed font matches.</CommandEmpty>
        <CommandGroup heading="Default">
          <FontItem
            value={DEFAULT_VALUE}
            family=""
            kind={kind}
            isChecked={!value}
            onPick={onPick}
          />
          {kind === 'mono' && (
            <FontItem
              value={SYSTEM_VALUE}
              family={SYSTEM_FONT[kind]}
              kind={kind}
              isChecked={value === SYSTEM_FONT[kind]}
              onPick={onPick}
            />
          )}
        </CommandGroup>
        {!isSavedListed && !typed && (
          <CommandGroup heading="Custom">
            <FontItem
              value={value}
              family={value}
              kind={kind}
              note={isMissingFont(value, fonts) ? 'Not installed' : undefined}
              isChecked
              onPick={onPick}
            />
          </CommandGroup>
        )}
        {installed.length > 0 && (
          <CommandGroup heading="Installed">
            {installed.map((family) => (
              <FontItem
                key={family}
                value={family}
                family={family}
                kind={kind}
                isChecked={value === family}
                onPick={onPick}
              />
            ))}
          </CommandGroup>
        )}
        {!!typed && !isListed && (
          <CommandGroup heading="Custom" forceMount>
            <CommandItem
              forceMount
              value={CUSTOM_PREFIX + typed}
              onSelect={() => onPick(typed)}
            >
              <span className="min-w-0 truncate">
                Use “
                <span style={{ fontFamily: fontStack(kind, typed) }}>
                  {typed}
                </span>
                ”
              </span>
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

function FontItem({
  value,
  family,
  kind,
  note,
  isChecked,
  onPick,
}: {
  value: string;
  family: string;
  kind: FontKind;
  note?: string;
  isChecked: boolean;
  onPick: (family: string) => void;
}) {
  const label =
    family === SYSTEM_FONT[kind]
      ? SYSTEM_FONT_LABEL[kind]
      : family || DEFAULT_FONT_LABEL[kind];
  return (
    <CommandItem
      value={value}
      keywords={[label]}
      data-checked={isChecked}
      onSelect={() => onPick(family)}
    >
      <span
        className="min-w-0 truncate"
        style={{ fontFamily: fontStack(kind, family) }}
      >
        {label}
      </span>
      {!!note && (
        <span className="shrink-0 type-caption text-muted-foreground">
          {note}
        </span>
      )}
    </CommandItem>
  );
}

/** Code fonts list only fixed-pitch families; the interface lists the rest. */
function familiesFor(kind: FontKind, fonts: SystemFont[] | null | undefined) {
  return (fonts ?? [])
    .filter((f) => f.isMono === (kind === 'mono'))
    .map((f) => f.family);
}

function familyOf(kind: FontKind, itemValue: string) {
  if (itemValue === DEFAULT_VALUE) return '';
  if (itemValue === SYSTEM_VALUE) return SYSTEM_FONT[kind];
  return itemValue.startsWith(CUSTOM_PREFIX)
    ? itemValue.slice(CUSTOM_PREFIX.length)
    : itemValue;
}
