/** The groups `get_settings` filters by, in Settings' order; `profile` is one profile's own settings. */
export const SETTING_SECTIONS = ['general', 'notifications', 'defaults', 'goals', 'git', 'terminal', 'browser', 'tools', 'data', 'harnesses', 'profile'] as const;

export type SettingSection = (typeof SETTING_SECTIONS)[number];
