import { useState } from 'react';
import { ArrowUp, Search } from 'reicon-react';
import { Calendar } from '@/components/ui/calendar';
import { Checkbox } from '@/components/ui/checkbox';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox';
import { DirectionProvider } from '@/components/ui/direction';
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupTextarea } from '@/components/ui/input-group';
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp';
import { Kbd } from '@/components/ui/kbd';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ProviderMark } from '../../ui';
import { Block, Grid, Section } from '../layout';
import { StateMatrix, previewState } from '../state-matrix';

const PROJECTS = ['latitude', 'liane', 'map-veto', 'focus-mode', 'alibi-proto'];

export function InputsSection() {
  return (
    <Section id="inputs" title="Inputs" intro="Hairline fields on the canvas. Text fields show focus as a brighter border only; checkboxes, radios and switches keep the ring.">
      <Block title="Field" use="Every form row: label, control, description, error. Groups use FieldGroup, never spaced divs." wide>
        <FieldGroup className="max-w-xl">
          <Field>
            <FieldLabel htmlFor="thread-title">Thread title</FieldLabel>
            <Input id="thread-title" defaultValue="Admin usage dashboard" />
            <FieldDescription>Shown in the sidebar, Orbit and the board.</FieldDescription>
          </Field>
          <Field data-invalid>
            <FieldLabel htmlFor="branch">Branch</FieldLabel>
            <Input id="branch" defaultValue="feat/admin usage" aria-invalid />
            <FieldError>Branch names can't contain spaces. Try feat/admin-usage.</FieldError>
          </Field>
          <Field data-disabled>
            <FieldLabel htmlFor="worktree">Worktree path</FieldLabel>
            <Input id="worktree" defaultValue="~/.mochi/worktrees/admin-usage" disabled />
            <FieldDescription>Set by the harness when the thread starts.</FieldDescription>
          </Field>
        </FieldGroup>
      </Block>

      <Grid>
        <Block title="Input" use="Search, comments, names.">
          <StateMatrix rows={['input'] as const} states={['default', 'hover', 'focus', 'disabled', 'invalid']} render={(_, state) => <Input placeholder="Search threads" aria-label="Search threads" aria-invalid={state === 'invalid' || undefined} {...previewState(state)} />} />
        </Block>
        <Block title="Textarea" use="Long-form goals and notes.">
          <Textarea aria-label="Goal" defaultValue="Every public API key is rate limited by plan tier, with per-key overrides and clear 429s." />
        </Block>
        <Block title="Input group" use="Inputs with addons: search with an icon, the composer with agent and send." wide>
          <InputGroup className="max-w-sm">
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput aria-label="Search" placeholder="Jump to a thread, step or file" />
            <InputGroupAddon align="inline-end">
              <Kbd>K</Kbd>
            </InputGroupAddon>
          </InputGroup>
          <InputGroup className="h-auto rounded-xl bg-card">
            <InputGroupTextarea aria-label="Message Claude" placeholder="Steer Claude while it works" className="min-h-14 type-prose" />
            <InputGroupAddon align="block-end" className="gap-2">
              <ProviderMark provider="claude" size={14} />
              <span className="type-caption text-muted-foreground">Claude</span>
              <span className="flex-1" />
              <InputGroupButton variant="default" size="sm">
                Steer
                <ArrowUp data-icon="inline-end" />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </Block>
        <SelectBlock />
        <Block title="Native select" use="Plain pickers where a custom menu adds nothing (settings, small forms).">
          <NativeSelect aria-label="Default agent" defaultValue="claude" className="max-w-56">
            <NativeSelectOption value="claude">Claude</NativeSelectOption>
            <NativeSelectOption value="codex">Codex</NativeSelectOption>
          </NativeSelect>
        </Block>
        <Block title="Combobox" use="Pick from a long, searchable list: projects, branches, skills.">
          <Combobox items={PROJECTS}>
            <ComboboxInput placeholder="Pick a project" aria-label="Project" />
            <ComboboxContent>
              <ComboboxEmpty>No project matches.</ComboboxEmpty>
              <ComboboxList>
                {(item: string) => (
                  <ComboboxItem key={item} value={item}>
                    {item}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </Block>
        <ChecksBlock />
        <RadioBlock />
        <SwitchBlock />
        <SliderBlock />
        <Block title="Input OTP" use="Pairing a device: the 6-digit code from the other machine.">
          <Field>
            <FieldLabel htmlFor="pair-code">Pairing code</FieldLabel>
            <InputOTP id="pair-code" maxLength={6} defaultValue="4821">
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
              </InputOTPGroup>
              <InputOTPSeparator />
              <InputOTPGroup>
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
            <FieldDescription>Shown on the machine you're pairing with.</FieldDescription>
          </Field>
        </Block>
        <CalendarBlock />
        <Block title="Label" use="Standalone labels outside a Field, like next to a switch in a toolbar.">
          <div className="flex items-center gap-2">
            <Switch id="auto-settle" defaultChecked />
            <Label htmlFor="auto-settle">Auto-settle after 3 idle days</Label>
          </div>
        </Block>
        <Block title="Right to left" use="Every field mirrors inside a DirectionProvider.">
          <DirectionProvider dir="rtl">
            <div dir="rtl" className="flex flex-col gap-3">
              <Input aria-label="RTL input" defaultValue="مرحبا بالعالم" />
              <div className="flex items-center gap-2">
                <Checkbox id="rtl-check" defaultChecked />
                <Label htmlFor="rtl-check">تفعيل</Label>
              </div>
            </div>
          </DirectionProvider>
        </Block>
      </Grid>
    </Section>
  );
}

function SelectBlock() {
  return (
    <Block title="Select" use="A short list of options with a custom menu: effort, model, sort order.">
      <StateMatrix
        rows={['select'] as const}
        states={['default', 'hover', 'focus', 'disabled', 'invalid']}
        render={(_, state) => (
          <Select defaultValue="medium" disabled={state === 'disabled'}>
            <SelectTrigger aria-label="Reasoning effort" aria-invalid={state === 'invalid' || undefined} {...(state === 'disabled' ? {} : previewState(state))}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="low">Low effort</SelectItem>
                <SelectItem value="medium">Medium effort</SelectItem>
                <SelectItem value="high">High effort</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      />
    </Block>
  );
}

function ChecksBlock() {
  return (
    <Block title="Checkbox" use="Independent options. Grouped in a FieldSet with a legend.">
      <FieldSet>
        <FieldLegend variant="label">When a thread settles</FieldLegend>
        <FieldGroup className="gap-3">
          <Field orientation="horizontal">
            <Checkbox id="close-terminals" defaultChecked />
            <FieldLabel htmlFor="close-terminals" className="font-normal">
              Close idle terminals
            </FieldLabel>
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="stop-watch" defaultChecked />
            <FieldLabel htmlFor="stop-watch" className="font-normal">
              Stop PR watches
            </FieldLabel>
          </Field>
          <Field orientation="horizontal" data-disabled>
            <Checkbox id="delete-worktree" disabled />
            <FieldLabel htmlFor="delete-worktree" className="font-normal">
              Delete the worktree (needs a clean tree)
            </FieldLabel>
          </Field>
        </FieldGroup>
      </FieldSet>
      <StateMatrix rows={['checkbox'] as const} states={['default', 'hover', 'focus', 'disabled', 'invalid']} render={(_, state) => <Checkbox aria-label={`Checkbox ${state}`} defaultChecked={state !== 'default'} aria-invalid={state === 'invalid' || undefined} {...previewState(state)} />} />
    </Block>
  );
}

function RadioBlock() {
  return (
    <Block title="Radio group" use="One choice from a few visible options. Always true circles.">
      <RadioGroup defaultValue="ask" aria-label="When an agent proposes a goal">
        {[
          ['ask', 'Ask first', 'The goal changes when you accept it'],
          ['apply', 'Apply with undo', 'It changes now; Undo puts the old goal back'],
        ].map(([value, title, desc]) => (
          <Field key={value} orientation="horizontal">
            <RadioGroupItem value={value} id={`proposed-${value}`} />
            <FieldContent>
              <FieldLabel htmlFor={`proposed-${value}`}>
                <FieldTitle>{title}</FieldTitle>
              </FieldLabel>
              <FieldDescription>{desc}</FieldDescription>
            </FieldContent>
          </Field>
        ))}
      </RadioGroup>
    </Block>
  );
}

function SwitchBlock() {
  return (
    <Block title="Switch" use="Settings that apply immediately. The label names the state it turns on.">
      <FieldGroup className="gap-3">
        {[
          ['notify', 'Notify me when a thread needs me', true, false],
          ['pip', 'Open previews as floating windows', true, false],
          ['telemetry', 'Share anonymous usage data', false, true],
        ].map(([id, label, checked, disabled]) => (
          <Field key={id as string} orientation="horizontal" data-disabled={disabled || undefined}>
            <Switch id={id as string} defaultChecked={checked as boolean} disabled={disabled as boolean} />
            <FieldLabel htmlFor={id as string} className="font-normal">
              {label}
            </FieldLabel>
          </Field>
        ))}
      </FieldGroup>
      <div className="flex items-center gap-2">
        <Switch id="switch-sm" size="sm" defaultChecked />
        <Label htmlFor="switch-sm" className="type-caption text-muted-foreground">
          Small, for dense rows
        </Label>
      </div>
    </Block>
  );
}

function SliderBlock() {
  const [value, setValue] = useState([5]);
  return (
    <Block title="Slider" use="A bounded number where the range matters more than the exact value.">
      <Field>
        <div className="flex items-center justify-between">
          <FieldLabel htmlFor="parallel">Parallel agents per space</FieldLabel>
          <span className="tabular type-meta text-muted-foreground">{value[0]}</span>
        </div>
        <Slider id="parallel" min={1} max={12} step={1} value={value} onValueChange={setValue} />
        <FieldDescription>Past 6, review becomes the bottleneck.</FieldDescription>
      </Field>
    </Block>
  );
}

function CalendarBlock() {
  const [date, setDate] = useState<Date | undefined>(new Date(2026, 9, 14));
  return (
    <Block title="Calendar" use="Scheduling: snooze a thread, run a task later.">
      <Calendar mode="single" selected={date} onSelect={setDate} defaultMonth={new Date(2026, 9, 1)} className="w-fit rounded-xl border" />
    </Block>
  );
}
