/** The pages `get_settings` filters by, in Settings' order; `profile` is one profile's own settings. */
export const SETTING_SECTIONS = ['general', 'appearance', 'notifications', 'keyboard', 'harnesses', 'models', 'goals', 'simplify', 'access', 'git', 'terminal', 'browser', 'remote', 'data', 'profile'] as const;

export type SettingSection = (typeof SETTING_SECTIONS)[number];
