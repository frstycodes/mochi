import type { ProjectsHost } from '../types/projects.ts';
import { desktopNamespace } from './rpc.ts';

export const projects = (): ProjectsHost => desktopNamespace('projects');
