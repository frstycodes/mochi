import type { ProjectsHost } from '@mochi/domain/host/types/projects';
import { desktopNamespace } from './rpc.ts';

export const projects = (): ProjectsHost => desktopNamespace('projects');
