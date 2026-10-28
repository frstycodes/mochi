// playwright-core ships no types for its registry, which installs browsers the way `npx playwright install` does.
declare module 'playwright-core/lib/coreBundle' {
  interface Executable {
    name: string;
    executablePath(sdkLanguage?: string): string | undefined;
  }
  export const registry: {
    registry: {
      findExecutable(name: string): Executable | undefined;
      install(
        executables: Executable[],
        options?: { force?: boolean },
      ): Promise<void>;
    };
  };
}
