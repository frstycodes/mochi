import type { ProjectsHost } from '../types/projects.ts';
import { bridge } from './bridge.ts';

export const projects = (): ProjectsHost => bridge().projects;
