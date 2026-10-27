import { MessageResponse } from '@/components/ai-elements/message';
import {
  VIZ_COMPONENTS,
  VIZ_PLUGINS,
  VIZ_REHYPE_PLUGINS,
  VisualContent,
} from '../../viz/FenceVisual';
import { VizThreadProvider } from '../../viz/WidgetVisual';
import { useHarness } from '../../store';
import {
  BROKEN_CHART_FENCE,
  CHART_FENCE,
  CODE_MARKDOWN,
  MERMAID_MARKDOWN,
  TABLE_MARKDOWN,
  TALL_WIDGET,
  TICTACTOE_WIDGET,
} from '../embedFixtures';
import { Block, Grid, Section } from '../layout';
import { DEMO_PHOTOS } from '../imageFixtures';
import { DevServerCard } from '../../chat/DevServerCard';

export function EmbedsSection() {
  const { state } = useHarness();
  return (
    <Section
      id="embeds"
      title="Embeds"
      intro="Fenced visuals, code blocks, tables, diagrams, widgets and MCP app views sit in one hairline frame with the content edge to edge, and their name in a caption row underneath. The actions appear at the end of that row on hover or keyboard focus, and always on touch."
    >
      <VizThreadProvider value={state.threads[0]!.id}>
        <Grid>
          <Block
            title="Widget"
            use="Agent-written HTML in a sandboxed frame. It paints its own margins, so the frame adds no padding."
          >
            <VisualContent
              language="html"
              code={TICTACTOE_WIDGET}
              title="Tic-tac-toe"
            />
          </Block>
          <Block
            title="Chart"
            use="The harness’s own visuals get 12px of padding inside the frame."
          >
            <VisualContent language="chart" code={CHART_FENCE} />
          </Block>
          <Block
            title="Tall widget"
            use="Grows with its content up to 900px, then scrolls inside the frame."
          >
            <VisualContent
              language="html"
              code={TALL_WIDGET}
              title="Service latency"
            />
          </Block>
          <Block
            title="Code block"
            use="A fenced code block in chat: the code flush in the frame, the language and copy and download in the caption row."
          >
            <MessageResponse
              plugins={VIZ_PLUGINS}
              components={VIZ_COMPONENTS}
              rehypePlugins={VIZ_REHYPE_PLUGINS}
            >
              {CODE_MARKDOWN}
            </MessageResponse>
          </Block>
          <Block
            title="Table"
            use="A markdown table: sortable columns, with copy, download and fullscreen in the caption row."
          >
            <MessageResponse
              plugins={VIZ_PLUGINS}
              components={VIZ_COMPONENTS}
              rehypePlugins={VIZ_REHYPE_PLUGINS}
            >
              {TABLE_MARKDOWN}
            </MessageResponse>
          </Block>
          <Block
            title="Diagram"
            use="A mermaid fence: the diagram flush in the frame, with copy, download (PNG, SVG, source) and fullscreen in the caption row."
          >
            <MessageResponse
              plugins={VIZ_PLUGINS}
              components={VIZ_COMPONENTS}
              rehypePlugins={VIZ_REHYPE_PLUGINS}
            >
              {MERMAID_MARKDOWN}
            </MessageResponse>
          </Block>
          <Block
            title="Loading and error"
            use="While the fence streams, a skeleton under the caption. A fence that doesn’t parse shows why and its source."
          >
            <VisualContent language="html" code="<div>" isIncomplete />
            <VisualContent language="chart" code={BROKEN_CHART_FENCE} />
          </Block>
          <Block
            title="Narrow chat"
            use="At 340px the caption truncates the name and keeps the actions."
          >
            <div className="w-[340px] max-w-full">
              <VisualContent
                language="html"
                code={TICTACTOE_WIDGET}
                title="Tic-tac-toe with a long name that truncates"
              />
            </div>
          </Block>
          <Block
            title="Dev server"
            use="start_dev_server's card: the page as it first loaded, the configuration's name, its port and whether it still listens. Open shows it in Preview; stopped, the button starts it again in the thread's terminal."
          >
            <div className="flex flex-col gap-4">
              <DevServerCard
                thread={state.threads[0]!}
                server={{
                  name: 'web',
                  command: 'pnpm dev',
                  source: 'launch.json',
                  port: 5173,
                  preview: DEMO_PHOTOS.screenshot.src,
                }}
              />
              <DevServerCard
                thread={state.threads[0]!}
                server={{
                  name: 'harness-app-with-a-long-configuration-name',
                  command: 'pnpm dev --port 5191 --strictPort',
                  source: 'launch.json',
                  port: 5191,
                }}
              />
            </div>
          </Block>
        </Grid>
      </VizThreadProvider>
    </Section>
  );
}
