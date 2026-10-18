import { CONNECTORS } from '../../library/connectors.ts';
import type { CatalogPlugin, CatalogSkill, MarketplaceCatalog } from '../../library/library.ts';

// The web build's stand-in catalogs: names and owners from the real repositories (anthropics/skills, openai/skills,
// anthropics/claude-plugins-official), icons from each owner's GitHub avatar, the way the desktop app shows them.
const avatar = (owner: string) => `https://github.com/${owner}.png?size=96`;

const skill = (owner: string, source: string, name: string, description: string, fileCount = 1): CatalogSkill => ({ name, description, source: `${source}/${name}`, fileCount, icon: avatar(owner) });

export const SKILL_CATALOGS: Record<string, CatalogSkill[]> = {
  'anthropics/skills': [
    skill('anthropics', 'anthropics/skills/skills', 'pdf', 'Extract text and tables, fill forms, merge and split PDF files.', 6),
    skill('anthropics', 'anthropics/skills/skills', 'docx', 'Create and edit Word documents with tracked changes and comments.', 5),
    skill('anthropics', 'anthropics/skills/skills', 'xlsx', 'Build spreadsheets with formulas, formatting and charts.', 4),
    skill('anthropics', 'anthropics/skills/skills', 'pptx', 'Create and edit slide decks with layouts and speaker notes.', 5),
    skill('anthropics', 'anthropics/skills/skills', 'frontend-design', 'Distinctive, production-grade interfaces that avoid generic AI looks.'),
    skill('anthropics', 'anthropics/skills/skills', 'canvas-design', 'Posters and visual art as PNG and PDF, from a design philosophy.', 3),
    skill('anthropics', 'anthropics/skills/skills', 'algorithmic-art', 'Generative art with p5.js: seeded randomness, flow fields, particles.', 4),
    skill('anthropics', 'anthropics/skills/skills', 'brand-guidelines', 'Apply Anthropic’s colors and type to anything that should look on-brand.', 2),
    skill('anthropics', 'anthropics/skills/skills', 'mcp-builder', 'Design and build MCP servers that let models use an API well.', 7),
    skill('anthropics', 'anthropics/skills/skills', 'skill-creator', 'Write, test and improve skills of your own.', 6),
    skill('anthropics', 'anthropics/skills/skills', 'webapp-testing', 'Drive a local web app with Playwright to check it works.', 3),
    skill('anthropics', 'anthropics/skills/skills', 'internal-comms', 'Status reports, updates and newsletters in your company’s voice.', 4),
  ],
  'openai/skills/skills/.curated': [
    skill('openai', 'openai/skills/skills/.curated', 'gh-fix-ci', 'Read failing GitHub Actions logs and fix what broke.', 2),
    skill('openai', 'openai/skills/skills/.curated', 'gh-address-comments', 'Work through a pull request’s review comments one by one.', 2),
    skill('openai', 'openai/skills/skills/.curated', 'figma-implement-design', 'Turn a Figma frame into code that matches it.', 3),
    skill('openai', 'openai/skills/skills/.curated', 'playwright', 'Automate a browser from the terminal to test and inspect pages.', 2),
    skill('openai', 'openai/skills/skills/.curated', 'sentry', 'Find, read and triage production errors in Sentry.', 2),
    skill('openai', 'openai/skills/skills/.curated', 'notion-spec-to-implementation', 'Turn a Notion spec into a plan and the code for it.', 3),
  ],
};

const plugin = (owner: string, name: string, title: string, description: string, category: string, version: string | null = null): CatalogPlugin => ({
  name,
  title,
  description,
  category,
  author: owner,
  version,
  homepage: null,
  icon: avatar(owner),
});

export const MARKETPLACE_CATALOGS: Record<string, MarketplaceCatalog> = {
  'claude-plugins-official': {
    name: 'claude-plugins-official',
    displayName: 'Claude plugins',
    description: "Anthropic's directory of Claude Code plugins",
    owner: 'Anthropic',
    format: 'claude',
    plugins: [
      plugin('anthropics', 'code-review', 'Code review', 'Review a pull request with agents for bugs, security and style.', 'development', '1.0.0'),
      plugin('anthropics', 'feature-dev', 'Feature development', 'Explore, plan, build and review a feature in guided phases.', 'development', '1.0.0'),
      plugin('anthropics', 'commit-commands', 'Commit commands', 'Commit, push and open a pull request in one step.', 'development', '1.0.0'),
      plugin('anthropics', 'pr-review-toolkit', 'PR review toolkit', 'Specialised reviewers for tests, types, comments and silent failures.', 'development', '1.0.0'),
      plugin('anthropics', 'security-guidance', 'Security guidance', 'Warns about risky patterns while the agent edits code.', 'security', '1.0.0'),
      plugin('anthropics', 'frontend-design', 'Frontend design', 'Interfaces with a point of view instead of the generic look.', 'design', '1.0.0'),
      plugin('anthropics', 'agent-sdk-dev', 'Agent SDK dev', 'Scaffold and check apps built on the Claude Agent SDK.', 'development', '1.0.0'),
      plugin('linear', 'linear', 'Linear', 'Issues, projects and cycles from Linear.', 'productivity'),
      plugin('stripe', 'stripe', 'Stripe', 'Payments, customers and subscriptions, plus Stripe’s best practices.', 'development'),
      plugin('vercel', 'vercel', 'Vercel', 'Deploy, read logs and manage projects on Vercel.', 'deployment'),
      plugin('supabase', 'supabase', 'Supabase', 'Databases, auth and edge functions in your Supabase projects.', 'database'),
      plugin('getsentry', 'sentry', 'Sentry', 'Errors, issues and releases, with fixes suggested in place.', 'monitoring'),
      plugin('figma', 'figma', 'Figma', 'Read designs and variables, and map components to code.', 'design'),
      plugin('makenotion', 'notion', 'Notion', 'Search, read and write Notion pages and databases.', 'productivity'),
      plugin('github', 'github', 'GitHub', 'Repositories, issues, pull requests and Actions.', 'development'),
      plugin('microsoft', 'playwright', 'Playwright', 'Drive a real browser to test and inspect web apps.', 'testing'),
      plugin('upstash', 'context7', 'Context7', 'Current documentation for the libraries in your project.', 'development'),
      plugin('firebase', 'firebase', 'Firebase', 'Firestore, auth and hosting in your Firebase projects.', 'database'),
      plugin('prisma', 'prisma', 'Prisma', 'Schema, migrations and queries with Prisma ORM.', 'database'),
      plugin('atlassian', 'atlassian', 'Atlassian', 'Jira issues and Confluence pages.', 'productivity'),
      plugin('HubSpot', 'hubspot', 'HubSpot', 'Contacts, companies and deals in your CRM.', 'productivity'),
      plugin('AikidoSec', 'aikido', 'Aikido', 'Scan code and dependencies for vulnerabilities.', 'security'),
      plugin('Airtable', 'airtable', 'Airtable', 'Bases, tables and records in Airtable.', 'productivity'),
      plugin('cloudflare', 'cloudflare', 'Cloudflare', 'Workers, KV, R2 and D1 in your account.', 'deployment'),
    ],
  },
};

/** What a fixture plugin unpacks into: a few parts by its kind, and the hosted server the product ones expect. */
export function fixtureParts(name: string, category: string | null) {
  const isProduct = category !== 'development' && category !== 'security' && category !== 'design' && category !== 'testing';
  const count = (n: number, part: string) => Array.from({ length: n }, (_, i) => `${name}-${part}-${i + 1}`);
  return {
    skills: count(isProduct ? 1 : 2, 'skill').map((n) => ({ name: n, description: '', body: '', files: {} })),
    subagents: count(isProduct ? 0 : 3, 'agent').map((n) => ({ name: n, description: '', body: '', fields: {} })),
    remotes: isProduct ? [{ name, url: CONNECTORS.find((c) => c.id === name)?.serverUrl ?? `https://mcp.${name}.com/mcp` }] : [],
  };
}
