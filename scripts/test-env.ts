// An agent shell inherits Mochi's core.hooksPath override (electron/git/hooks.ts), so its commit-msg hook would reject
// the throwaway commits tests make ("init"). Test files run as child processes and inherit this env.
for (const key of Object.keys(process.env)) if (key.startsWith('GIT_CONFIG_')) delete process.env[key];
