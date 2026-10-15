import type { McpWidget, McpWidgetResource } from '../model';

/** Mobbin's `search_screens` view as `readMcpResource` returned it (2026-10-15), and one call's input and result, trimmed to six screens. */
export const MOBBIN_RESOURCE: McpWidgetResource = {
  html: '<!doctype html>\n<html>\n  <head>\n    <meta charset="UTF-8" />\n    <script type="module" crossorigin src="https://mobbin.com/mcp-apps/searchScreens/index.js"></script>\n    <link rel="stylesheet" crossorigin href="https://mobbin.com/mcp-apps/searchScreens/index.css">\n  </head>\n  <body>\n    <div id="root"></div>\n  </body>\n</html>\n',
  meta: { ui: { csp: { resourceDomains: ['https://bytescale.mobbin.com', 'https://mobbin.com'] }, permissions: { clipboardWrite: {} } } },
};

const screen = (id: string, short: string, app_name: string) => ({ id, image_url: `https://mobbin.com/api/mcp/short/${short}`, mobbin_url: `https://mobbin.com/screens/${id}`, app_name, platform: 'ios' });

export const MOBBIN_WIDGET: McpWidget = {
  server: 'claude.ai mobbin',
  uri: 'ui://mobbin/search-screens.html',
  input: { query: 'onboarding', platform: 'ios', output_destination: 'chat' },
  result: {
    content: [{ type: 'text', text: 'Wispr Flow' }],
    structuredContent: {
      query: 'onboarding',
      screens: [
        screen('cd21e1a0-24ac-442c-b4a0-ce0f1675639f', 'zAJMHF8R', 'Wispr Flow'),
        screen('c4d7b115-9d60-47e2-8b97-3f167647e7f0', '3vTsy0OH', 'Tabby'),
        screen('380e2b96-9a8f-4b5b-bd2f-60c86994f96a', 'jIFlHcBn', 'Wealthsimple'),
        screen('4c1a5a8e-d7bb-40b8-96d4-d104e844cd6f', 'enQj4vHk', 'LinkedIn'),
        screen('d01d762e-dff5-4442-8183-7b2a8490596f', '5xwrZyfk', 'Paired'),
        screen('701bd14e-394d-4916-a982-eb5e5caed29f', 'TFurCO4C', 'Ubank Money App'),
      ],
    },
  },
};
