import { lazy, Suspense } from 'react';
import {
  defaultRehypePlugins,
  type Components,
  type CustomRendererProps,
  type PluginConfig,
  type StreamdownProps,
} from 'streamdown';
import { Warning } from '@/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { useHarness } from '../store';
import { CodeFrame } from './CodeFrame';
import { withThemeVars } from './exportVisual';
import {
  metaTitle,
  parseFence,
  VIZ_LANGUAGES,
  type VizLanguage,
  type VizSpecs,
} from '@mochi/domain/viz/fence';
import { DiffVisual, MetroVisual } from './HarnessVisuals';
import { ImageVisual } from './ImageVisual';
import { SortableTable } from './SortableTable';
import { EmbedFrame } from './EmbedFrame';
import { VISUAL_ICONS, VisualFrame, type VisualSource } from './VisualFrame';
import { WidgetVisual } from './WidgetVisual';
import { FileCode } from '../files/FileCode';
import { ChatLink } from '../chat/ChatLink';
import { rehypeRefs, rehypeRelativeLinks } from '../chat/rehypeRefs';

const ChartVisual = lazy(() =>
  import('./ChartVisual').then((m) => ({ default: m.ChartVisual })),
);

/** Streamdown hooks for chat messages: fenced visuals plus code block, table, image, file-path and PR/issue link overrides. Widgets need a VizThreadProvider above. */
export const VIZ_PLUGINS = {
  renderers: [{ language: [...VIZ_LANGUAGES], component: FenceVisual }],
} satisfies PluginConfig;

export const VIZ_COMPONENTS = {
  code: CodeFrame,
  table: SortableTable,
  img: ImageVisual,
  inlineCode: FileCode,
  a: ChatLink,
} satisfies Components;

type SanitizeSchema = { protocols?: Record<string, string[] | undefined> };
const [sanitize, schema] = defaultRehypePlugins.sanitize as [
  unknown,
  SanitizeSchema,
];

// Streamdown's sanitize step keeps only http(s) image sources, though its harden step is set to pass data:image/ URLs.
// Adding `data` to the sanitize schema lets inline screenshots through; harden still rejects any data: URL that isn't an image.
export const VIZ_REHYPE_PLUGINS = [
  defaultRehypePlugins.raw,
  [
    sanitize,
    {
      ...schema,
      protocols: {
        ...schema.protocols,
        src: [...(schema.protocols?.src ?? []), 'data'],
      },
    },
  ],
  rehypeRelativeLinks,
  defaultRehypePlugins.harden,
  // After harden: the links it adds point at refs and paths the chip and path renderers check themselves.
  rehypeRefs,
] as NonNullable<StreamdownProps['rehypePlugins']>;

function FenceVisual({
  code,
  isIncomplete,
  language,
  meta,
}: CustomRendererProps) {
  return (
    <VisualContent
      language={language as VizLanguage}
      code={code}
      isIncomplete={isIncomplete}
      title={metaTitle(meta)}
    />
  );
}

/** One fenced visual from its source: a placeholder while it streams, the source on error. The side pane's visual tabs render it again. */
export function VisualContent({
  language,
  code,
  isIncomplete = false,
  title,
}: {
  language: VizLanguage;
  code: string;
  isIncomplete?: boolean;
  title?: string;
}) {
  const fence = parseFence(language, code, isIncomplete);
  if (fence.status === 'pending') return <PendingVisual language={language} />;
  if (fence.status === 'error')
    return (
      <BrokenVisual language={language} code={code} message={fence.message} />
    );
  return (
    <ReadyVisual
      language={language}
      spec={fence.spec}
      source={SOURCES[language](code)}
      code={code}
      title={title}
    />
  );
}

function ReadyVisual({
  language,
  spec,
  source,
  code,
  title,
}: {
  language: VizLanguage;
  spec: VizSpecs[VizLanguage];
  source: VisualSource;
  code: string;
  title?: string;
}) {
  const { state } = useHarness();
  const threadOf = (id: string) => state.threads.find((t) => t.id === id);

  switch (language) {
    case 'chart': {
      const chart = spec as VizSpecs['chart'];
      return (
        <VisualFrame
          fence={{ language, code }}
          title={title ?? chart.title ?? `${capitalize(chart.type)} chart`}
          source={source}
        >
          <Suspense fallback={<Skeleton className="h-40" />}>
            <ChartVisual spec={chart} />
          </Suspense>
        </VisualFrame>
      );
    }
    case 'svg':
    case 'html': {
      const markup = spec as string;
      const name = title ?? (language === 'svg' ? 'SVG' : 'Widget');
      return (
        <VisualFrame
          fence={{ language, code }}
          title={name}
          source={source}
          canPicture={language === 'svg'}
          svg={() => withThemeVars(markup)}
        >
          <WidgetVisual source={markup} title={name} />
        </VisualFrame>
      );
    }
    case 'harness-metro': {
      const ids = (spec as VizSpecs['harness-metro']).threads;
      const missing = ids.filter((id) => !threadOf(id));
      if (missing.length)
        return (
          <BrokenVisual
            language={language}
            code={code}
            message={`no thread ${missing.map((id) => `"${id}"`).join(', ')}`}
          />
        );
      return (
        <VisualFrame
          fence={{ language, code }}
          title={title ?? 'Linked threads'}
          source={source}
        >
          <MetroVisual threads={ids.map((id) => threadOf(id)!)} />
        </VisualFrame>
      );
    }
    case 'harness-diff': {
      const diff = spec as VizSpecs['harness-diff'];
      return (
        <VisualFrame
          fence={{ language, code }}
          title={title ?? diff.title ?? 'Changes'}
          source={source}
          canPicture={false}
        >
          <DiffVisual spec={diff} />
        </VisualFrame>
      );
    }
  }
}

const JSON_SOURCE = (text: string): VisualSource => ({
  text,
  ext: 'json',
  type: 'application/json',
});

const SOURCES = {
  chart: JSON_SOURCE,
  svg: (text) => ({ text, ext: 'svg', type: 'image/svg+xml' }),
  html: (text) => ({ text, ext: 'html', type: 'text/html' }),
  'harness-metro': JSON_SOURCE,
  'harness-diff': JSON_SOURCE,
} satisfies Record<VizLanguage, (text: string) => VisualSource>;

const PENDING_LABELS = {
  chart: 'Drawing chart',
  svg: 'Drawing image',
  html: 'Building widget',
  'harness-metro': 'Drawing metro',
  'harness-diff': 'Summing changes',
} satisfies Record<VizLanguage, string>;

function PendingVisual({ language }: { language: VizLanguage }) {
  return (
    <EmbedFrame
      icon={VISUAL_ICONS[language]}
      title={`${PENDING_LABELS[language]}…`}
      className="my-3"
    >
      <Skeleton className="h-40 w-full rounded-none" />
    </EmbedFrame>
  );
}

function BrokenVisual({
  language,
  code,
  message,
}: {
  language: VizLanguage;
  code: string;
  message: string;
}) {
  return (
    <EmbedFrame
      icon={Warning}
      iconClassName="text-warning"
      title={`Couldn't render this ${language.replace('harness-', '')}`}
      className="my-3"
    >
      <p role="alert" className="px-3 pt-3 type-caption text-muted-foreground">
        {message}
      </p>
      <pre className="max-h-60 overflow-auto p-3 font-mono type-caption whitespace-pre-wrap">
        {code}
      </pre>
    </EmbedFrame>
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
