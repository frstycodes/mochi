import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/toast/store';
import { renderSkillMd } from './skillMd';
import type { Library } from './useLibrary';

/** Write a skill in Mochi: its name, when an agent should reach for it, and its instructions, saved as the skill's SKILL.md. */
export function WriteSkillDialog({ isOpen, onClose, library }: { isOpen: boolean; onClose: () => void; library: Library }) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">{isOpen && <WriteSkillForm library={library} onDone={onClose} />}</DialogContent>
    </Dialog>
  );
}

function WriteSkillForm({ library, onDone }: { library: Library; onDone: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [isSaving, setSaving] = useState(false);
  const slug = skillSlug(name);
  const canSave = !!slug && !!description.trim() && !!body.trim() && !isSaving;
  const save = async () => {
    setSaving(true);
    const isAdded = await library.addSkill({ 'SKILL.md': renderSkillMd(slug, description.trim(), body) });
    setSaving(false);
    if (!isAdded) return;
    toast(`Added ${slug}`, { description: 'On for this profile; Claude Code threads load it from the library.' });
    onDone();
  };
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) void save();
      }}
    >
      <DialogHeader>
        <DialogTitle>Write a skill</DialogTitle>
        <DialogDescription>Saved to your library as a SKILL.md, the format Claude Code and Codex read.</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="skill-name">Name</FieldLabel>
          <Input id="skill-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="release-notes" />
          <FieldDescription>{slug ? `Lowercase with dashes: ${slug}` : 'Lowercase letters, numbers and dashes'}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="skill-description">When to use it</FieldLabel>
          <Input id="skill-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Use when writing release notes from merged PRs" />
          <FieldDescription>Agents read this to decide when the skill applies.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="skill-body">Instructions</FieldLabel>
          <Textarea id="skill-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder={'# Release notes\n\n1. List the PRs merged since the last tag…'} className="min-h-48 font-mono type-meta" />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!canSave}>
          Add skill
        </Button>
      </DialogFooter>
    </form>
  );
}

/** "Release Notes!" → `release-notes`, the name agents call it by. */
export function skillSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Two hidden pickers for uploading a skill: a SKILL.md alone, or a whole skill folder (its files read as text, paths kept
 * relative to the folder). `pick('file' | 'folder')` opens one; what's picked goes straight to the library.
 */
export function useSkillUpload(library: Library) {
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const add = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!picked.length) return;
    const files = await skillFiles(picked);
    if (!files) return toast.error('Not added', { description: 'Pick a SKILL.md, or a folder with one at its top.' });
    if (await library.addSkill(files)) toast('Skill added', { description: 'On for this profile.' });
  };
  const inputs = (
    <>
      <input ref={fileInput} type="file" accept=".md,text/markdown" hidden onChange={add} />
      {/* `webkitdirectory` isn't in React's input props; every browser Mochi runs in reads it. */}
      <input ref={folderInput} type="file" hidden onChange={add} {...{ webkitdirectory: '' }} />
    </>
  );
  return { inputs, pick: (what: 'file' | 'folder') => (what === 'file' ? fileInput : folderInput).current?.click() };
}

// GAP: binary files in an uploaded folder (images, fonts) are left out; the library holds a skill's text files only.
async function skillFiles(picked: File[]): Promise<Record<string, string> | null> {
  if (picked.length === 1 && !picked[0].webkitRelativePath) return { 'SKILL.md': await picked[0].text() };
  const entries = await Promise.all(
    picked.map(async (file) => {
      const path = file.webkitRelativePath.split('/').slice(1).join('/');
      if (!path || path.split('/').some((part) => part.startsWith('.') || part === 'node_modules')) return null;
      const text = await file.text();
      return text.includes('\u0000') ? null : ([path, text] as const);
    }),
  );
  const files = Object.fromEntries(entries.filter((e) => e !== null));
  return files['SKILL.md'] === undefined ? null : files;
}
