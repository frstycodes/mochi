import {
  parseLeaderboard,
  SKILLS_SH,
  skillsShSkill,
} from '../../../../apps/desktop/src/library/skillsSh.ts';
import { cached } from './catalog.ts';

/**
 * skills.sh, the skills CLI's directory. Its documented `/api/v1` needs a Vercel OIDC token, which only an app deployed on
 * Vercel has, so Mochi uses what the CLI itself calls: `/api/search` (`npx skills find`). Results are cached like catalogs.
 */

export function searchSkillsSh(query: string) {
  const q = query.trim();
  if (q.length < 2) return Promise.resolve([]);
  return cached(`skills.sh:search:${q.toLowerCase()}`, async () => {
    const response = await fetch(
      `${SKILLS_SH}/api/search?${new URLSearchParams({ q, limit: '50' })}`,
      { headers: { 'User-Agent': 'mochi' } },
    );
    if (!response.ok)
      throw new Error(`skills.sh search failed (HTTP ${response.status})`);
    const { skills } = (await response.json()) as {
      skills?: {
        source?: string;
        skillId?: string;
        name?: string;
        installs?: number;
      }[];
    };
    return (skills ?? []).flatMap((s) =>
      s.source && s.skillId
        ? [
            skillsShSkill(
              s.source,
              s.skillId,
              s.name ?? s.skillId,
              s.installs ?? 0,
            ),
          ]
        : [],
    );
  });
}

/**
 * The all-time leaderboard on skills.sh's front page. GAP: no unauthenticated JSON lists it, so it is read from the
 * `initialSkills` the page embeds for its own leaderboard: one request an hour, and an empty list (search still works)
 * the day the page changes shape.
 */
export function popularSkillsSh() {
  return cached('skills.sh:popular', async () => {
    const response = await fetch(SKILLS_SH, {
      headers: { 'User-Agent': 'mochi' },
    });
    if (!response.ok)
      throw new Error(`skills.sh didn't answer (HTTP ${response.status})`);
    return parseLeaderboard(await response.text());
  });
}
