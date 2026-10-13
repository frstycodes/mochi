import { useEffect, useMemo, useState } from 'react';
import { DocumentCode, RotateLeft } from 'reicon-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { host } from '../../host';
import { parseHex } from '../../themes/color';
import { themeFileText } from '../../themes/custom';
import { themeTokens } from '../../themes/map';
import { THEME_VARIABLE_GROUPS, type ColorTheme, type ThemeVariable } from '../../themes/model';
import { refreshThemes, setThemeEditing } from '../../themes/store';
import { TooltipIconButton } from '../../ui';

/**
 * A custom theme's `mochi` block as color fields, painted live while open. An empty field inherits: from the theme's VS Code
 * `colors` where they map, else Mochi's own value (always so for status colors).
 */
export function ThemeVariableEditor({ theme, onEditJson, onDone }: { theme: ColorTheme; onEditJson: () => void; onDone: () => void }) {
  const { own, setVariable, inherited, invalid, save } = useThemeDraft(theme, onDone);
  const hasInvalid = invalid.length > 0;
  return (
    <div className="flex flex-col gap-4">
      {GROUPS.map((group) => (
        <section key={group} aria-labelledby={`theme-group-${group}`} className="flex flex-col gap-1">
          <h3 id={`theme-group-${group}`} className="type-meta text-muted-foreground">
            {group}
            {!!GROUP_NOTES[group] && <span className="text-subtle-foreground"> · {GROUP_NOTES[group]}</span>}
          </h3>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {THEME_VARIABLE_GROUPS[group].map((name) => (
              <VariableField key={name} name={name} group={group} value={own[name] ?? ''} inherited={inherited[name]} isInvalid={invalid.includes(name)} onChange={(value) => setVariable(name, value)} />
            ))}
          </div>
        </section>
      ))}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onEditJson}>
          <DocumentCode data-icon="inline-start" />
          Edit JSON
        </Button>
        <span className="flex-1" />
        {hasInvalid && <span className="type-meta text-destructive">Fix {invalid.length === 1 ? 'the highlighted color' : 'the highlighted colors'} to save</span>}
        <Button variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={hasInvalid}>
          Save theme
        </Button>
      </div>
    </div>
  );
}

const GROUPS = Object.keys(THEME_VARIABLE_GROUPS) as (keyof typeof THEME_VARIABLE_GROUPS)[];

// Said once per group so the inheritance rule for status and diff colors is visible where you'd edit them.
const GROUP_NOTES: Partial<Record<keyof typeof THEME_VARIABLE_GROUPS, string>> = {
  Status: "PR and run states; Mochi's unless set here",
  Diff: "from the theme's git colors, else Mochi's",
};

function VariableField({ name, group, value, inherited, isInvalid, onChange }: { name: ThemeVariable; group: string; value: string; inherited: string | undefined; isInvalid: boolean; onChange: (value: string) => void }) {
  const label = variableLabel(name);
  const shown = (!isInvalid && value) || inherited;
  const id = `theme-var-${name}`;
  return (
    <div className="flex h-8 items-center gap-2">
      <label
        className="relative size-5 shrink-0 cursor-pointer rounded-sm shadow-[inset_0_0_0_1px_var(--border)] has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
        style={{ background: shown ?? `var(--${name})` }}
      >
        <input
          type="color"
          aria-label={`Pick ${label} (${group.toLowerCase()})`}
          value={(shown ?? '#808080').slice(0, 7)}
          // The native picker has no alpha: keep the field's own, so translucent hairlines stay translucent.
          onChange={(e) => onChange(e.target.value + (shown?.length === 9 ? shown.slice(7) : ''))}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      <label htmlFor={id} className="min-w-0 flex-1 truncate type-body">
        {label}
        <span className="sr-only"> ({group.toLowerCase()})</span>
      </label>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value.trim())}
        placeholder={inherited ?? 'Mochi'}
        spellCheck={false}
        aria-invalid={isInvalid}
        className="w-28 font-mono tabular-nums"
      />
      <TooltipIconButton label="Reset" hint={inherited ? `Back to ${inherited} from the theme's colors` : "Back to Mochi's color"} onClick={() => onChange('')} className={value ? '' : 'invisible'}>
        <RotateLeft />
      </TooltipIconButton>
    </div>
  );
}

/** `muted-foreground` under Text reads "Muted", `syntax-keyword` under Syntax "Keyword": the group already says the rest. */
function variableLabel(name: string) {
  const short = name.replace(/-foreground$/, '').replace(/^(syntax|diff)-/, '');
  return short.charAt(0).toUpperCase() + short.slice(1).replaceAll('-', ' ');
}

/** The editor's state: overrides as typed, what each field inherits, which fail to parse, and saving the file. */
function useThemeDraft(theme: ColorTheme, onDone: () => void) {
  const [own, setOwn] = useState<Record<string, string>>(theme.theme.mochi ?? {});
  const inherited = useMemo(() => {
    const tokens = themeTokens({ ...theme.theme, mochi: {} }, theme.kind);
    return Object.fromEntries(Object.entries(tokens).map(([token, hex]) => [token.slice(2), hex])) as Partial<Record<ThemeVariable, string>>;
  }, [theme]);
  const invalid = Object.entries(own).flatMap(([name, value]) => (value && !parseHex(value) ? [name] : []));
  const written = useMemo(() => Object.fromEntries(Object.entries(own).filter(([, value]) => !!parseHex(value))), [own]);
  const draft = useMemo(() => ({ ...theme, theme: { ...theme.theme, mochi: written } }), [theme, written]);

  useEffect(() => setThemeEditing(draft), [draft]);
  useEffect(() => () => setThemeEditing(null), []);

  const setVariable = (name: ThemeVariable, value: string) =>
    setOwn((current) => (value ? { ...current, [name]: value } : Object.fromEntries(Object.entries(current).filter(([key]) => key !== name))));
  const save = async () => {
    if (theme.source.kind !== 'custom') return;
    const { name, type, ...rest } = theme.theme;
    try {
      await host.themes.saveCustom(themeFileText({ name, type, ...rest, mochi: written }), theme.source.file);
      await refreshThemes();
      toast.success(`Saved ${theme.label}`);
      onDone();
    } catch (error) {
      toast.error('Could not save the theme', { description: (error as Error).message });
    }
  };
  return { own, setVariable, inherited, invalid, save };
}
