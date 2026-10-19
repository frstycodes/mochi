// Older Mochi builds point an agent shell's git at their own hooks through GIT_CONFIG_* env, whose commit-msg hook would
// reject the throwaway commits tests make ("init"). Test files run as child processes and inherit this env.
for (const key of Object.keys(process.env)) if (key.startsWith('GIT_CONFIG_')) delete process.env[key];
