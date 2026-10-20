import type { SkillsShSkill } from './library.ts';

export const SKILLS_SH = 'https://skills.sh';

/** The leaderboard skills.sh's front page embeds (`initialSkills`), as escaped JSON inside its RSC payload; first 100. */
export function parseLeaderboard(html: string): SkillsShSkill[] {
  const start = html.indexOf('initialSkills');
  if (start < 0) throw new Error("skills.sh's leaderboard couldn't be read; search still works");
  const entry = /\{\\?"source\\?":\\?"([\w.-]+\/[\w.-]+)\\?",\\?"skillId\\?":\\?"([^"\\]+)\\?",\\?"name\\?":\\?"([^"\\]+)\\?",\\?"installs\\?":(\d+)/g;
  const skills: SkillsShSkill[] = [];
  for (const [, source, skillId, name, installs] of html.slice(start, start + 200_000).matchAll(entry)) {
    if (skills.length >= 100) break;
    if (!skills.some((s) => s.id === `${source}/${skillId}`)) skills.push(skillsShSkill(source, skillId, name, Number(installs)));
  }
  return skills;
}

export const skillsShSkill = (source: string, skillId: string, name: string, installs: number): SkillsShSkill => ({
  id: `${source}/${skillId}`,
  name,
  source,
  installs,
  installSource: `${source}@${skillId}`,
  url: `${SKILLS_SH}/${source}/${skillId}`,
  icon: `https://github.com/${source.split('/')[0]}.png?size=96`,
});
