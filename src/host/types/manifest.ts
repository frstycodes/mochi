// `invoke` methods round-trip through ipcMain.handle; `event` methods take a callback and return an unsubscribe.
export type MethodKind = 'invoke' | 'event';

export type Manifest<T> = { [K in keyof T]-?: MethodKind };
