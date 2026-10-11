import { useState, type ComponentProps, type ReactNode } from 'react';
import { ArrowUp, BranchUp, Laptop, Mic, Monitor, Paperclip, ShieldCheck } from 'reicon-react';
import { toast } from 'sonner';
import { Attachment, AttachmentInfo, AttachmentPreview, AttachmentRemove, Attachments } from '@/components/ai-elements/attachments';
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input';
import { AutoHeight } from '@/components/ui/auto-height';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Provider } from './model';
import { EffortPicker, ModelPicker, type ModelOption } from './ModelControls';

/** The glass card. Holds an optional tray above a ComposerInput. */
export function ComposerCard({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('surface-glass overflow-hidden rounded-2xl border shadow-float transition-colors has-[textarea:focus]:border-primary/30', className)} {...props}>
      <AutoHeight className="justify-end">{children}</AutoHeight>
    </div>
  );
}

type ComposerInputProps = Omit<ComponentProps<typeof PromptInputTextarea>, 'onSubmit'> & {
  provider: Provider;
  onModelChange?: (model: ModelOption) => void;
  onSend: (message: PromptInputMessage) => void;
  submitLabel?: string;
};

export function ComposerInput({ provider, onModelChange, onSend, submitLabel = 'Send', className, ...textareaProps }: ComposerInputProps) {
  return (
    <PromptInput multiple globalDrop className="[&_[data-slot=input-group]]:rounded-none [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent" onSubmit={onSend}>
      <ComposerAttachments />
      <PromptInputBody>
        <PromptInputTextarea className={cn('min-h-12 px-4 pt-3 type-prose max-md:text-base', className)} {...textareaProps} />
      </PromptInputBody>
      <PromptInputFooter className="px-2 pb-2">
        <PromptInputTools>
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger tooltip="Attach" className="rounded-full">
              <Paperclip className="size-4" />
            </PromptInputActionMenuTrigger>
            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments />
              <PromptInputActionAddScreenshot />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
          <ModelPicker provider={provider} onModelChange={onModelChange} />
          <EffortPicker />
        </PromptInputTools>
        <PromptInputTools>
          <PromptInputButton tooltip="Dictate" className="rounded-full" onClick={() => toast('Dictation is not in the prototype yet')}>
            <Mic className="size-4" />
          </PromptInputButton>
          <PromptInputSubmit aria-label={submitLabel} className="rounded-full">
            <ArrowUp className="size-4" />
          </PromptInputSubmit>
        </PromptInputTools>
      </PromptInputFooter>
    </PromptInput>
  );
}

function ComposerAttachments() {
  const { files, remove } = usePromptInputAttachments();
  if (files.length === 0) return null;
  const images = files.filter((f) => f.mediaType?.startsWith('image/'));
  const others = files.filter((f) => !f.mediaType?.startsWith('image/'));
  return (
    <PromptInputHeader className="gap-2 px-3 pt-3">
      {images.length > 0 && (
        <Attachments variant="grid" className="ml-0">
          {images.map((f) => (
            <Attachment key={f.id} data={f} onRemove={() => remove(f.id)} className="size-16 rounded-lg ring-1 ring-border">
              <AttachmentPreview />
              <AttachmentRemove />
            </Attachment>
          ))}
        </Attachments>
      )}
      {others.length > 0 && (
        <Attachments variant="inline">
          {others.map((f) => (
            <Attachment key={f.id} data={f} onRemove={() => remove(f.id)}>
              <AttachmentPreview />
              <AttachmentInfo className="type-caption" />
              <AttachmentRemove />
            </Attachment>
          ))}
        </Attachments>
      )}
    </PromptInputHeader>
  );
}

/** One line under the card for where and how the agent runs. The gradient fades the transcript scrolling under it. */
export function ComposerMeta({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'relative flex h-8 items-center gap-1 px-1 type-caption text-subtle-foreground before:absolute before:-inset-x-6 before:-top-6 before:bottom-0 before:-z-10 before:bg-linear-to-t before:from-background before:from-40% before:to-transparent',
        className,
      )}
      {...props}
    />
  );
}

const ACCESS = ['Ask first', 'Auto edit', 'Full access'];
const DEVICES = ['This Mac', 'Studio', 'Cloud sandbox'];

export function RunOnMenu() {
  const [device, setDevice] = useState(DEVICES[0]);
  return <MetaMenu icon={device === 'Cloud sandbox' ? <Monitor /> : <Laptop />} label="Run on" value={device} options={DEVICES} onChange={setDevice} />;
}

export function PermissionsMenu() {
  const [access, setAccess] = useState(ACCESS[1]);
  return <MetaMenu icon={<ShieldCheck />} label="Permissions" value={access} options={ACCESS} onChange={setAccess} />;
}

export function BranchLabel({ branch }: { branch: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1 px-1.5 font-mono">
      <BranchUp className="size-3.5 shrink-0" />
      <span className="truncate">{branch}</span>
    </span>
  );
}

function MetaMenu({ icon, label, value, options, onChange }: { icon: ReactNode; label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" className="text-subtle-foreground hover:text-foreground" aria-label={`${label}: ${value}`}>
          {icon}
          {value}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {options.map((o) => (
              <DropdownMenuRadioItem key={o} value={o}>
                {o}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
