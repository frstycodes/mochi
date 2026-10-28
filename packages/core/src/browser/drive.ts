import { stat } from 'node:fs/promises';
import { errors, type Locator, type Page } from 'playwright-core';
import type {
  BrowserAct,
  BrowserSnapshot,
  BrowserWait,
} from '@mochi/domain/host/types/browser';
import { agentSnapshot, ariaSelector } from './ariaRefs.ts';

// Mochi's browser tools on a Playwright page, whoever owns the page: main's Electron views (apps/desktop/electron/browser/views.ts)
// or Core's headless Chromium (`headless.ts`). A ref names the snapshot `generation` it came from.

/** The page as an accessibility-style tree with refs; `nextGeneration` is called once the tree is read and numbers its refs. */
export async function snapshotPage(
  page: Page,
  nextGeneration: () => number,
): Promise<BrowserSnapshot> {
  const yaml = await page
    .ariaSnapshot({ mode: 'ai', timeout: SNAPSHOT_TIMEOUT_MS })
    .catch(rethrowForAgent);
  const generation = nextGeneration();
  const { text, refs } = agentSnapshot(yaml, generation);
  const flags = await Promise.all(
    refs.map(({ ref }) =>
      formFlags(page.locator(ariaSelector(ref, generation)!)),
    ),
  );
  return {
    text,
    refs: Object.fromEntries(
      refs.map(({ ref, role, name }, i) => [ref, { role, name, ...flags[i]! }]),
    ),
  };
}
/** Whether clicking the element sends its form, and whether it takes a password: the agent asks or masks before acting. */
function formFlags(target: Locator) {
  return target
    .evaluate(
      (el) => {
        const type = (el.getAttribute('type') ?? '').toLowerCase();
        const form = (el as HTMLButtonElement).form ?? el.closest('form');
        return {
          isSubmit:
            !!form &&
            (type === 'submit' ||
              type === 'image' ||
              (el.localName === 'button' && !type)),
          isPassword: type === 'password',
        };
      },
      undefined,
      { timeout: FLAGS_TIMEOUT_MS },
    )
    .catch(() => FAIL_CLOSED_FLAGS);
}

// An element that can't be checked is treated as both, so the agent asks before clicking it and never echoes what it types.
const FAIL_CLOSED_FLAGS = { isSubmit: true, isPassword: true };
const SNAPSHOT_TIMEOUT_MS = 10_000;
const FLAGS_TIMEOUT_MS = 2000;

export async function runAct(
  page: Page,
  generation: number,
  act: BrowserAct,
): Promise<{ note?: string }> {
  const timeout = ACTION_TIMEOUT_MS;
  switch (act.kind) {
    case 'click':
      await (await locate(page, generation, act.ref)).click({ timeout });
      return {};
    case 'hover':
      await (await locate(page, generation, act.ref)).hover({ timeout });
      return {};
    case 'drag': {
      const from = await locate(page, generation, act.from);
      await from.dragTo(await locate(page, generation, act.to), { timeout });
      return {};
    }
    case 'type': {
      const target = await locate(page, generation, act.ref);
      const select = await selectState(target, act.text);
      if (!select.isSelect) await target.fill(act.text, { timeout });
      else await pickOption(target, act.text, select.value);
      return {};
    }
    case 'select': {
      const target = await locate(page, generation, act.ref);
      const select = await selectState(target, act.value);
      if (!select.isSelect)
        throw new Error(
          'That element is not a <select>; use browser_type for a text field or browser_click for a custom dropdown',
        );
      await pickOption(target, act.value, select.value);
      return {};
    }
    case 'upload':
      return upload(page, generation, act);
    case 'press': {
      const key = act.key === 'Space' ? ' ' : act.key;
      await page.keyboard.press(key).catch((error: unknown) => {
        throw String(error).includes('Unknown key')
          ? new Error(
              `Unknown key "${act.key}"; use a single character or a key name like Enter, Tab, Escape, Backspace, ArrowDown, PageDown or Space`,
            )
          : error;
      });
      return {};
    }
    case 'scroll':
      return scroll(page, generation, act);
  }
}

export const ACTION_TIMEOUT_MS = 5000;

async function upload(
  page: Page,
  generation: number,
  act: Extract<BrowserAct, { kind: 'upload' }>,
) {
  if (
    !(await stat(act.path).then(
      (s) => s.isFile(),
      () => false,
    ))
  )
    throw new Error(`No file at ${act.path}`);
  const target = await locate(page, generation, act.ref);
  if (!(await isFileInput(target)))
    throw new Error(
      'That element is not a file input; browser_snapshot shows one as a button named after its label',
    );
  await target.setInputFiles(act.path, { timeout: ACTION_TIMEOUT_MS });
  return {};
}

async function scroll(
  page: Page,
  generation: number,
  act: Extract<BrowserAct, { kind: 'scroll' }>,
) {
  const timeout = ACTION_TIMEOUT_MS;
  const target = act.ref
    ? await locate(page, generation, act.ref)
    : page.locator(':root');
  if (act.ref) await target.scrollIntoViewIfNeeded({ timeout });
  const box = act.ref ? await target.boundingBox({ timeout }) : null;
  const at = box
    ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    : await page.evaluate(() => ({
        x: innerWidth / 2,
        y: innerHeight / 2,
      }));
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(act.dx, act.dy);
  const { x, y, maxY } = await target.evaluate(settledScroll, undefined, {
    timeout,
  });
  return { note: `Scrolled to ${x}, ${y} of ${maxY}` };
}
const GONE = (ref: string) =>
  `No element ${ref} on the page now; take a new browser_snapshot`;

/** `ref`'s element from the latest snapshot; one from an older snapshot, or gone from the page, fails at once. */
export async function locate(page: Page, generation: number, ref: string) {
  const selector = ariaSelector(ref, generation);
  if (!selector) throw new Error(GONE(ref));
  const target = page.locator(selector);
  if (!(await target.count().catch(() => 0))) throw new Error(GONE(ref));
  return target;
}

/** For a `<select>`, the value of the option whose label or value is `want` (null when none is). */
function selectState(target: Locator, want: string) {
  return target.evaluate(
    (el, want) =>
      el instanceof HTMLSelectElement
        ? {
            isSelect: true,
            value:
              [...el.options].find((o) => o.label === want || o.value === want)
                ?.value ?? null,
          }
        : { isSelect: false, value: null },
    want,
    { timeout: ACTION_TIMEOUT_MS },
  );
}

/** Playwright waits out its timeout on any other element instead of failing. A label stands for its control, as in Playwright. */
function isFileInput(target: Locator) {
  return target.evaluate(
    (el) => {
      const input = el instanceof HTMLLabelElement ? el.control : el;
      return input instanceof HTMLInputElement && input.type === 'file';
    },
    undefined,
    { timeout: ACTION_TIMEOUT_MS },
  );
}

async function pickOption(target: Locator, want: string, value: string | null) {
  if (value === null)
    throw new Error(`No option ${JSON.stringify(want)} in that list`);
  await target.selectOption({ value }, { timeout: ACTION_TIMEOUT_MS });
}

/** The scroll position of `el` (the page's, for the root) once it has stopped moving, so a smooth scroll reports where it ends. */
function settledScroll(el: Element) {
  const box =
    el === document.documentElement ? (document.scrollingElement ?? el) : el;
  const read = () => ({
    x: Math.round(box.scrollLeft),
    y: Math.round(box.scrollTop),
    maxY: Math.round(box.scrollHeight - box.clientHeight),
  });
  return new Promise<ReturnType<typeof read>>((resolve) => {
    let last = read();
    let still = 0;
    const deadline = Date.now() + 1000;
    const tick = () => {
      const now = read();
      still = now.x === last.x && now.y === last.y ? still + 1 : 0;
      last = now;
      if (still >= 3 || Date.now() > deadline) resolve(now);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Playwright's errors carry a call log; the agent gets one line it can act on. */
export function rethrowForAgent(error: unknown): never {
  const message = (error instanceof Error ? error.message : String(error))
    .split('\n')[0]!
    .replace(/^[\w.]+: /, '');
  if (error instanceof errors.TimeoutError)
    throw new Error(
      `${message} The page may be busy, or the element hidden, disabled or covered; take a new browser_snapshot`,
    );
  if (message.includes('Element is not an <input>, <textarea>'))
    throw new Error('That element takes no text');
  throw new Error(message);
}

/** Resolves once the page shows `text`, matches `selector` or its URL contains `url` (any one given), or after `timeoutMs` from `start`. */
export async function waitOnPage(
  page: Page | null,
  until: BrowserWait,
  start: number,
) {
  const { text, selector, url } = until;
  // Playwright reads a timeout of 0 as "never"; connecting already spent part of the wait.
  const timeout = Math.max(1, until.timeoutMs - (Date.now() - start));
  const waits = !page
    ? []
    : [
        text && page.getByText(text).first().waitFor({ timeout }),
        selector &&
          page
            .locator(selector)
            .first()
            .waitFor({ state: 'attached', timeout }),
        url &&
          page.waitForURL((u) => u.href.includes(url), {
            timeout,
            waitUntil: 'commit',
          }),
      ].filter((wait) => !!wait);
  if (!waits.length) await new Promise((r) => setTimeout(r, timeout));
  const isMet =
    !!waits.length &&
    (await Promise.any(waits).then(() => true, falseIfAllTimedOut));
  return { isMet, waitedMs: Date.now() - start };
}

/** A wait that failed for any reason but time, like a bad selector, is the agent's to see. */
function falseIfAllTimedOut({ errors: reasons }: AggregateError) {
  const failure = reasons.find(
    (reason) => !(reason instanceof errors.TimeoutError),
  );
  return failure ? rethrowForAgent(failure) : false;
}
