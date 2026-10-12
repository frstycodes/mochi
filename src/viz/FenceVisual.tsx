import type { ReactNode } from 'react';
import { CodeBlock, defaultRehypePlugins, type Components, type CustomRendererProps, type PluginConfig, type StreamdownProps } from 'streamdown';
import { Warning } from 'reicon-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useHarness } from '../store';
import { ChartVisual } from './ChartVisual';
import { withThemeVars } from './exportVisual';
import { parseFence, VIZ_LANGUAGES, type VizLanguage, type VizSpecs } from './fence';
import { BurnupVisual, DiffVisual, MetroVisual } from './HarnessVisuals';
import { ImageVisual } from './ImageVisual';
import { SortableTable } from './SortableTable';
import { VisualFrame, type VisualSource } from './VisualFrame';
import { WidgetVisual } from './WidgetVisual';
import { FileCode } from '../files/FileCode';

/** Streamdown hooks for agent messages: fenced visuals plus table, image and file-path overrides. Widgets need a VizThreadProvider above. */
export const VIZ_PLUGINS = { renderers: [{ language: [...VIZ_LANGUAGES], component: FenceVisual }] } satisfies PluginConfig;

export const VIZ_COMPONENTS = { table: SortableTable, img: ImageVisual, inlineCode: FileCode } satisfies Components;

type SanitizeSchema = { protocols?: Record<string, string[] | undefined> };
const [sanitize, schema] = defaultRehypePlugins.sanitize as [unknown, SanitizeSchema];

// Streamdown's sanitize step keeps only http(s) image sources, though its harden step is set to pass data:image/ URLs.
// Adding `data` to the sanitize schema lets inline screenshots through; harden still rejects any data: URL that isn't an image.
export const VIZ_REHYPE_PLUGINS = [
  defaultRehypePlugins.raw,
  [sanitize, { ...schema, protocols: { ...schema.protocols, src: [...(schema.protocols?.src ?? []), 'data'] } }],
  defaultRehypePlugins.harden,
] as NonNullable<StreamdownProps['rehypePlugins']>;

function FenceVisual({ code, isIncomplete, language, meta }: CustomRendererProps) {
  const lang = language as VizLanguage;
  const fence = parseFence(lang, code, isIncomplete);
  const source = SOURCES[lang](code);
  if (fence.status === 'pending') return <PendingVisual label={PENDING_LABELS[lang]} />;
  if (fence.status === 'error') return <BrokenVisual language={lang} code={code} message={fence.message} />;
  return <ReadyVisual language={lang} spec={fence.spec} source={source} code={code} title={metaTitle(meta)} />;
}

function ReadyVisual({ language, spec, source, code, title }: { language: VizLanguage; spec: VizSpecs[VizLanguage]; source: VisualSource; code: string; title?: string }) {
  const { state } = useHarness();
  const threadOf = (id: string) => state.threads.find((t) => t.id === id);

  switch (language) {
    case 'chart': {
      const chart = spec as VizSpecs['chart'];
      return (
        <VisualFrame title={title ?? chart.title ?? `${capitalize(chart.type)} chart`} source={source}>
          <ChartVisual spec={chart} />
        </VisualFrame>
      );
    }
    case 'svg':
    case 'html': {
      const markup = spec as string;
      const name = title ?? (language === 'svg' ? 'SVG' : 'Widget');
      return (
        <VisualFrame title={name} source={source} canPicture={language === 'svg'} svg={() => withThemeVars(markup)}>
          <WidgetVisual source={markup} title={name} />
        </VisualFrame>
      );
    }
    case 'harness-burnup': {
      const thread = threadOf((spec as VizSpecs['harness-burnup']).thread);
      if (!thread) return <BrokenVisual language={language} code={code} message={`no thread "${(spec as VizSpecs['harness-burnup']).thread}"`} />;
      return (
        <VisualFrame title={title ?? `Burn-up · ${thread.title}`} source={source}>
          <BurnupVisual thread={thread} />
        </VisualFrame>
      );
    }
    case 'harness-metro': {
      const ids = (spec as VizSpecs['harness-metro']).threads;
      const missing = ids.filter((id) => !threadOf(id));
      if (missing.length) return <BrokenVisual language={language} code={code} message={`no thread ${missing.map((id) => `"${id}"`).join(', ')}`} />;
      return (
        <VisualFrame title={title ?? 'Linked threads'} source={source}>
          <MetroVisual threads={ids.map((id) => threadOf(id)!)} />
        </VisualFrame>
      );
    }
    case 'harness-diff': {
      const diff = spec as VizSpecs['harness-diff'];
      return (
        <VisualFrame title={title ?? diff.title ?? 'Changes'} source={source} canPicture={false}>
          <DiffVisual spec={diff} />
        </VisualFrame>
      );
    }
  }
}

const JSON_SOURCE = (text: string): VisualSource => ({ text, ext: 'json', type: 'application/json' });

const SOURCES = {
  chart: JSON_SOURCE,
  svg: (text) => ({ text, ext: 'svg', type: 'image/svg+xml' }),
  html: (text) => ({ text, ext: 'html', type: 'text/html' }),
  'harness-burnup': JSON_SOURCE,
  'harness-metro': JSON_SOURCE,
  'harness-diff': JSON_SOURCE,
} satisfies Record<VizLanguage, (text: string) => VisualSource>;

const PENDING_LABELS = {
  chart: 'Drawing chart',
  svg: 'Drawing image',
  html: 'Building widget',
  'harness-burnup': 'Drawing burn-up',
  'harness-metro': 'Drawing metro',
  'harness-diff': 'Summing changes',
} satisfies Record<VizLanguage, string>;

function PendingVisual({ label }: { label: string }) {
  return (
    <Placeholder>
      <span className="type-caption text-subtle-foreground">{label}…</span>
      <Skeleton className="h-40 w-full rounded-lg" />
    </Placeholder>
  );
}

function BrokenVisual({ language, code, message }: { language: VizLanguage; code: string; message: string }) {
  return (
    <Placeholder>
      <span role="alert" className="flex items-center gap-1.5 type-caption text-muted-foreground">
        <Warning aria-hidden className="size-3.5 shrink-0 text-warning" />
        Couldn't render this {language.replace('harness-', '')}: {message}
      </span>
      <CodeBlock code={code} language={SOURCES[language](code).ext} />
    </Placeholder>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return <div className="my-3 flex flex-col gap-2 rounded-xl bg-card p-3 ring-1 ring-border">{children}</div>;
}

function metaTitle(meta?: string) {
  return meta?.match(/title="([^"]+)"/)?.[1];
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
