import { expect, test } from '@playwright/test';

test.skip(
  !process.env.MOCHI_PROTOTYPE_URL,
  'Set MOCHI_PROTOTYPE_URL to a running web dev server.',
);

test('directory row opens actions and branch row copies its name in both themes', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 800, height: 1000 });
  await page.addInitScript(() =>
    localStorage.setItem(
      'harness.worktrees',
      JSON.stringify({ e2e: '/tmp/checkout-worktree' }),
    ),
  );
  await page.goto(process.env.MOCHI_PROTOTYPE_URL!);
  await page
    .getByRole('button', { name: /Codex Fix flaky checkout e2e/ })
    .click();
  await page
    .getByRole('button', { name: 'Thread summary', exact: true })
    .click();
  const environment = page
    .getByRole('dialog', { name: 'Thread summary', exact: true })
    .getByRole('region', { name: 'Environment', exact: true });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((theme) => {
      document.documentElement.setAttribute('data-theme', theme);
    }, theme);
    const directory = environment.getByRole('button', {
      name: 'latitude',
      exact: true,
    });
    await directory.focus();
    await directory.press('Enter');
    await expect(
      page.getByRole('menuitem', { name: 'Copy path', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: 'Open in terminal', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    const branch = environment.locator('button[title]');
    const name = await branch.innerText();
    await expect(branch).toHaveAttribute(
      'title',
      /Worktree: checkout-worktree/,
    );
    await expect(environment).not.toContainText('checkout-worktree');
    await branch.focus();
    await branch.press('Enter');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(name);
  }
});
