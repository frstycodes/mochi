import { z } from 'zod';
import type { GeneratedImage } from '../model.ts';

/**
 * Claude's `generate_image` on Mochi's server, run by the harness Settings › Models picks (`AgentSettings.imageGen`). Codex
 * threads don't get it: they generate natively. Main runs it (`electron/mcp/server.ts`); the Claude mapper turns the call
 * into the same image card a Codex image gets.
 */
export const IMAGE_TOOL = 'generate_image';

/** The frame's width / height while the image is made, and how the size is asked for. */
export const IMAGE_SIZES = {
  square: { aspect: 1, ask: 'square (1:1)' },
  landscape: { aspect: 3 / 2, ask: 'landscape (3:2)' },
  portrait: { aspect: 2 / 3, ask: 'portrait (2:3)' },
} as const;

export type ImageSize = keyof typeof IMAGE_SIZES;

export const IMAGE_TOOL_DESCRIPTION =
  "Generate an image (illustration, icon, mockup, photo, texture) from a text prompt. The user sees it in the thread as it's made; you get the image back. Pass saveTo to also write it into your worktree, like \"public/hero.png\". Takes up to a minute or two and counts against the user's plan, so make one at a time.";

export const IMAGE_TOOL_SHAPE = {
  prompt: z.string().min(1).max(4000).describe('What to draw: subject, style, composition, colors, any text to render'),
  size: z.enum(Object.keys(IMAGE_SIZES) as [ImageSize, ...ImageSize[]]).optional().describe('Default square'),
  saveTo: z.string().optional().describe('A path inside your worktree to copy the image to, like "assets/logo.png"'),
};

const PATH_LINE = 'Image file: ';

/** The result's first line names the file, so the mapper finds it even when the image is too big to return. */
export const imageResultText = (path: string, savedTo?: string) => [`${PATH_LINE}${path}`, ...(savedTo ? [`Saved to ${savedTo}`] : [])].join('\n');

/** The card for a `generate_image` call: running from its input, done or failed from its result text. */
export function imageCard(input: Record<string, unknown>, result?: { text: string; isError?: boolean }): GeneratedImage {
  const prompt = typeof input.prompt === 'string' ? { prompt: input.prompt } : {};
  const aspect = IMAGE_SIZES[input.size as ImageSize]?.aspect ?? 1;
  if (!result) return { status: 'running', ...prompt, aspect };
  const src = result.isError ? undefined : result.text.split('\n').find((line) => line.startsWith(PATH_LINE))?.slice(PATH_LINE.length);
  return src ? { status: 'done', ...prompt, aspect, src } : { status: 'failed', ...prompt, aspect, error: result.text || 'The image wasn’t generated.' };
}
