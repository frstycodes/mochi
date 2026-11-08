import { expect, test } from '@playwright/test';

test.skip(
  !process.env.MOCHI_PROTOTYPE_URL,
  'Set MOCHI_PROTOTYPE_URL to a running web dev server.',
);

test('real thread surfaces share agent identity, preserve selection and fit both themes', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${process.env.MOCHI_PROTOTYPE_URL}/#thread-agent`);
  await expect(
    page.getByRole('heading', { name: 'Agent icons · real components' }),
  ).toBeVisible();
  const workspace = page.locator('[data-slot="sidebar-inset"]');
  await expect(
    workspace.getByRole('img', { name: 'Claude', exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Thread switcher', exact: true })
    .click();
  const switcher = page.getByRole('listbox', { name: 'Switch thread' });
  const longThread = switcher
    .getByRole('option')
    .filter({ hasText: 'A very long thread title' });
  await expect(
    longThread.getByRole('img', { name: 'Codex', exact: true }),
  ).toBeVisible();
  await longThread.click();
  await expect(switcher).toHaveCount(0);
  await expect(
    workspace.locator('h1').getByRole('img', { name: 'Codex', exact: true }),
  ).toBeVisible();
  const missingSurface = page
    .getByRole('heading', { name: 'Missing agent · display-only row fixture' })
    .locator('..');
  await expect(
    missingSurface.getByRole('img', { name: 'Agent unavailable' }),
  ).toHaveCount(2);
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(workspace.locator('h1')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('thread-agent-real-light.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Switch theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({
    path: testInfo.outputPath('thread-agent-real-dark.png'),
    fullPage: true,
  });
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.locator('main').first()).toHaveJSProperty(
    'scrollWidth',
    375,
  );
  await page.screenshot({
    path: testInfo.outputPath('thread-agent-real-mobile.png'),
  });
  await page.getByRole('button', { name: 'Switch theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('suggested thread icons follow the proposed agent selection', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto(`${process.env.MOCHI_PROTOTYPE_URL}/#thread-agent`);
  const card = page
    .getByRole('region', { name: 'Suggested threads', exact: true })
    .first();
  const title = card
    .locator('p')
    .filter({ hasText: 'Share the token bucket across workers' })
    .first();
  await expect(
    title.getByRole('img', { name: 'Claude', exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('region', {
        name: 'Start this in its own thread?',
        exact: true,
      })
      .locator('p')
      .first()
      .getByRole('img', { name: 'Claude', exact: true }),
  ).toBeVisible();
  await card.getByRole('button', { name: 'Options', exact: true }).click();
  await card.getByRole('button', { name: /^Claude / }).click();
  await page.getByRole('tab', { name: /^Codex/ }).click();
  await page.getByRole('menuitemcheckbox').first().click();
  await expect(
    title.getByRole('img', { name: 'Codex', exact: true }),
  ).toBeVisible();
  await expect(
    title.getByRole('img', { name: 'Claude', exact: true }),
  ).toHaveCount(0);
  await card.getByRole('button', { name: 'Options', exact: true }).click();
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('suggested-thread-icons-before-theme.png'),
  });
  await page.getByRole('button', { name: 'Switch theme', exact: true }).click();
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('suggested-thread-icons-after-theme.png'),
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await card.scrollIntoViewIfNeeded();
  await expect(
    title.getByRole('img', { name: 'Codex', exact: true }),
  ).toBeVisible();
  await expect(page.locator('main').first()).toHaveJSProperty(
    'scrollWidth',
    375,
  );
  await page.screenshot({
    path: testInfo.outputPath('suggested-thread-icons-mobile.png'),
  });
});
