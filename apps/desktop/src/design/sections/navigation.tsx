import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Block, Grid, Section } from '../layout';

export function NavigationSection() {
  return (
    <Section
      id="navigation"
      title="Navigation"
      intro="Tabs switch views in place, breadcrumbs show where a thread lives, menus hold the app commands."
    >
      <Grid>
        <Block
          title="Tabs"
          use="Segmented tabs for a small set of peer views; line tabs inside panels."
        >
          <Tabs defaultValue="changes">
            <TabsList>
              <TabsTrigger value="changes">Changes</TabsTrigger>
              <TabsTrigger value="browser">Browser</TabsTrigger>
              <TabsTrigger value="terminal">Terminal</TabsTrigger>
            </TabsList>
            <TabsContent
              value="changes"
              className="type-meta text-muted-foreground"
            >
              14 files, +612 −389
            </TabsContent>
            <TabsContent
              value="browser"
              className="type-meta text-muted-foreground"
            >
              localhost:3000/admin/usage
            </TabsContent>
            <TabsContent
              value="terminal"
              className="type-meta text-muted-foreground"
            >
              pnpm dev is running
            </TabsContent>
          </Tabs>
          <Tabs defaultValue="steps">
            <TabsList variant="line">
              <TabsTrigger value="steps">Steps</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="files">Files</TabsTrigger>
            </TabsList>
          </Tabs>
        </Block>
      </Grid>
    </Section>
  );
}
