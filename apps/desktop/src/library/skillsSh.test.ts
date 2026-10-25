import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { parseLeaderboard } from './skillsSh.ts';

test('parseLeaderboard reads the escaped initialSkills the skills.sh front page embeds', () => {
  const html = String.raw`<script>self.__next_f.push([1,"4c:[\"$\",\"$L53\",null,{\"initialSkills\":[{\"source\":\"vercel-labs/skills\",\"skillId\":\"find-skills\",\"name\":\"find-skills\",\"installs\":3927274,\"weeklyInstalls\":[1,2],\"isOfficial\":true},{\"source\":\"mattpocock/skills\",\"skillId\":\"grill-me\",\"name\":\"grill-me\",\"installs\":1387557}]}]"])</script>`;
  const skills = parseLeaderboard(html);
  assert.deepEqual(
    skills.map((s) => [s.id, s.installs, s.installSource, s.url]),
    [
      [
        'vercel-labs/skills/find-skills',
        3927274,
        'vercel-labs/skills@find-skills',
        'https://skills.sh/vercel-labs/skills/find-skills',
      ],
      [
        'mattpocock/skills/grill-me',
        1387557,
        'mattpocock/skills@grill-me',
        'https://skills.sh/mattpocock/skills/grill-me',
      ],
    ],
  );
  assert.throws(
    () => parseLeaderboard('<html>changed</html>'),
    /search still works/,
  );
});
