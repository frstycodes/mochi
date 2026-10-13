/** The groups `get_settings` filters by, in Settings' order; `profile` is one profile's own settings. */
export const SETTING_SECTIONS = ['general', 'simplify', 'themes', 'notifications', 'devices', 'harnesses', 'defaults', 'background', 'goals', 'git', 'terminal', 'browser', 'tools', 'data', 'profile'] as const;

export type SettingSection = (typeof SETTING_SECTIONS)[number];
