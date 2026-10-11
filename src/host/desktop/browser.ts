import type { BrowserHost } from '../types/browser.ts';
import { bridge } from './bridge.ts';

export const browser = (): BrowserHost => bridge().browser;
