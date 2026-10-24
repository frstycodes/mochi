// Reads a SKILL.md the way Claude Code and Codex do: frontmatter name and description, folder name as fallback.
export function parseSkillMd(markdown: string, folderName: string) {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const name = (frontmatter.name ?? folderName).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const description =
    frontmatter.description ??
    body
      .split('\n')
      .find((line) => line.trim())
      ?.trim() ??
    name;
  return { name, description: description.slice(0, 1024), body };
}

/** A SKILL.md for a skill written in Mochi: its frontmatter as Claude Code and Codex read it, then the instructions. */
export function renderSkillMd(name: string, description: string, body: string) {
  return `---\nname: ${name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body.trim()}\n`;
}

/** `metadata: { internal: true }`, which the skills CLI hides unless asked; splitFrontmatter reads top-level keys only. */
export function isInternalSkill(markdown: string) {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
  return /^metadata:[ \t]*\r?\n(?:[ \t]+.*\r?\n)*?[ \t]+internal:[ \t]*true[ \t]*$/m.test(`${frontmatter}\n`);
}

// Reads the `key: value` and block-scalar (`|` / `>`) frontmatter that skills use; not a general YAML parser.
export function splitFrontmatter(markdown: string) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: {} as Record<string, string>, body: markdown.trim() };
  const frontmatter: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const pair = lines[index].match(/^([\w-]+):\s*(.*)$/);
    if (!pair) continue;
    const [, key, raw] = pair;
    if (raw === '|' || raw === '>' || raw === '|-' || raw === '>-') {
      const block: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) block.push(lines[++index].trim());
      frontmatter[key] = block.join(raw.startsWith('|') ? '\n' : ' ');
      continue;
    }
    frontmatter[key] = unquote(raw.trim());
  }
  return { frontmatter, body: markdown.slice(match[0].length).trim() };
}

function unquote(value: string) {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}
