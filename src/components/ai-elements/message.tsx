"use client";

import { Button } from "@/components/ui/button";
import {
  ButtonGroup,
  ButtonGroupText,
} from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { UIMessage } from "ai";
import { ChevronLeft as ChevronLeftIcon, ChevronRight as ChevronRightIcon } from '@/icons';
import type { ComponentProps, HTMLAttributes, ReactElement } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CodeHighlighterPlugin } from "@streamdown/code";
import type { ThemeRegistrationAny } from "shiki";
import { shikiTheme } from "@/themes/shiki";
import { LIGHT_CODE_SURFACES, readableTokenColors } from "@/themes/map";
import type { ColorTheme } from "@/themes/model";
import { useColorTheme } from "@/themes/store";
import { Streamdown, type PluginConfig } from "streamdown";
import { useWordReveal, WORD_REVEAL } from "@/chat/wordReveal";
import { withDiffFences } from "@/chat/diffCodePlugin";
import { markdownPlugins } from "@/chat/markdownPlugins";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
};

interface MessageBranchContextType {
  currentBranch: number;
  totalBranches: number;
  goToPrevious: () => void;
  goToNext: () => void;
  branches: ReactElement[];
  setBranches: (branches: ReactElement[]) => void;
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(
  null
);

const useMessageBranch = () => {
  const context = useContext(MessageBranchContext);

  if (!context) {
    throw new Error(
      "MessageBranch components must be used within MessageBranch"
    );
  }

  return context;
};

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

export const MessageBranch = ({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<ReactElement[]>([]);

  const handleBranchChange = useCallback(
    (newBranch: number) => {
      setCurrentBranch(newBranch);
      onBranchChange?.(newBranch);
    },
    [onBranchChange]
  );

  const goToPrevious = useCallback(() => {
    const newBranch =
      currentBranch > 0 ? currentBranch - 1 : branches.length - 1;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const goToNext = useCallback(() => {
    const newBranch =
      currentBranch < branches.length - 1 ? currentBranch + 1 : 0;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const contextValue = useMemo<MessageBranchContextType>(
    () => ({
      branches,
      currentBranch,
      goToNext,
      goToPrevious,
      setBranches,
      totalBranches: branches.length,
    }),
    [branches, currentBranch, goToNext, goToPrevious]
  );

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div
        className={cn("grid w-full gap-2 [&>div]:pb-0", className)}
        {...props}
      />
    </MessageBranchContext.Provider>
  );
};

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageBranchContent = ({
  children,
  ...props
}: MessageBranchContentProps) => {
  const { currentBranch, setBranches, branches } = useMessageBranch();
  const childrenArray = useMemo(
    () => (Array.isArray(children) ? children : [children]),
    [children]
  );

  // Use useEffect to update branches when they change
  useEffect(() => {
    if (branches.length !== childrenArray.length) {
      setBranches(childrenArray);
    }
  }, [childrenArray, branches, setBranches]);

  return childrenArray.map((branch, index) => (
    <div
      className={cn(
        "grid gap-2 overflow-hidden [&>div]:pb-0",
        index === currentBranch ? "block" : "hidden"
      )}
      key={branch.key}
      {...props}
    >
      {branch}
    </div>
  ));
};

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup>;

export const MessageBranchSelector = ({
  className,
  ...props
}: MessageBranchSelectorProps) => {
  const { totalBranches } = useMessageBranch();

  // Don't render if there's only one branch
  if (totalBranches <= 1) {
    return null;
  }

  return (
    <ButtonGroup
      className={cn(
        "[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md",
        className
      )}
      orientation="horizontal"
      {...props}
    />
  );
};

export type MessageBranchPreviousProps = ComponentProps<typeof Button>;

export const MessageBranchPrevious = ({
  children,
  ...props
}: MessageBranchPreviousProps) => {
  const { goToPrevious, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  );
};

export type MessageBranchNextProps = ComponentProps<typeof Button>;

export const MessageBranchNext = ({
  children,
  ...props
}: MessageBranchNextProps) => {
  const { goToNext, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  );
};

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>;

export const MessageBranchPage = ({
  className,
  ...props
}: MessageBranchPageProps) => {
  const { currentBranch, totalBranches } = useMessageBranch();

  return (
    <ButtonGroupText
      className={cn(
        "border-none bg-transparent text-muted-foreground shadow-none",
        className
      )}
      {...props}
    >
      {currentBranch + 1} of {totalBranches}
    </ButtonGroupText>
  );
};

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

export const MessageResponse = memo(
  ({ className, plugins, isAnimating = false, ...props }: MessageResponseProps) => {
    const loaded = useStreamdownPlugins(typeof props.children === "string" ? props.children : "");
    const { mode, light, dark } = useColorTheme();
    const code = useMemo(() => themedCodePlugin(light, dark), [loaded, light, dark]);
    const merged = useMemo(() => ({ ...loaded, ...(code && { code }), ...plugins }), [loaded, code, plugins]);
    const mermaid = useMemo(() => ({ config: { theme: mode === "dark" ? "dark" : "neutral" } as const }), [mode]);
    // Streamdown's memoised blocks ignore a changed mermaid config or code plugin, so a block keeps the old theme until remounted.
    const hasFence = typeof props.children === "string" && props.children.includes("```");
    // Streamdown drops the word wrappers once isAnimating goes false, so words still queued would pop in together.
    const isRevealing = useTrailingTrue(isAnimating, STREAM_DRAIN_MS);
    const ref = useRef<HTMLDivElement>(null);
    useWordReveal(ref, isRevealing);
    return (
      <div ref={ref} className="contents">
        <Streamdown
          key={hasFence ? `${mode}:${code ? `${light?.id}:${dark?.id}` : ""}` : undefined}
          className={cn(
            "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
            className
          )}
          plugins={merged}
          mermaid={mermaid}
          animated
          isAnimating={isRevealing}
          {...props}
        />
      </div>
    );
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    nextProps.isAnimating === prevProps.isAnimating
);

MessageResponse.displayName = "MessageResponse";

// Streamdown only wraps words in spans; useWordReveal animates them, because Streamdown's own CSS animation re-stamps shown words with a 0ms duration on every delta, cutting their fade short.
const STREAM_DRAIN_MS = WORD_REVEAL.maxBacklogMs + WORD_REVEAL.duration;

function useTrailingTrue(value: boolean, holdMs: number) {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    if (value) return setHeld(true);
    const timer = setTimeout(() => setHeld(false), holdMs);
    return () => clearTimeout(timer);
  }, [value, holdMs]);
  return value || held;
}

let loadedPlugins: PluginConfig = {};
let codeModule: typeof import("@streamdown/code") | null = null;
let defaultCodeThemes: [ThemeRegistrationAny, ThemeRegistrationAny] | null = null;
const codePlugins = new Map<string, CodeHighlighterPlugin>();

/** The code plugin for the chosen color themes (null = Mochi, which keeps GitHub's); undefined until the plugins load or when both are Mochi. */
function themedCodePlugin(light: ColorTheme | null, dark: ColorTheme | null) {
  if (!codeModule || !defaultCodeThemes || (!light && !dark)) return undefined;
  const themes: [ThemeRegistrationAny, ThemeRegistrationAny] = [light ? shikiTheme(light) : defaultCodeThemes[0], dark ? shikiTheme(dark) : defaultCodeThemes[1]];
  const key = `${themes[0].name}|${themes[1].name}`;
  let plugin = codePlugins.get(key);
  if (!plugin) codePlugins.set(key, (plugin = withDiffFences(codeModule.createCodePlugin({ themes }))));
  return plugin;
}
const pluginsLoading: Partial<Record<keyof ReturnType<typeof markdownPlugins>, Promise<unknown>>> = {};

const PLUGIN_LOADERS = {
  code: () => Promise.all([
    import("@streamdown/code"),
    import("shiki/dist/themes/github-light.mjs"),
    import("shiki/dist/themes/github-dark.mjs"),
  ]).then(([code, light, dark]) => {
    codeModule = code;
    // github-light's orange, red, green and grey tokens read under 4.5:1 on Mochi's code background.
    const readableLight = { ...light.default, tokenColors: readableTokenColors(light.default.tokenColors ?? [], LIGHT_CODE_SURFACES) };
    defaultCodeThemes = [readableLight, dark.default];
    loadedPlugins = { ...loadedPlugins, code: withDiffFences(code.createCodePlugin({ themes: defaultCodeThemes })) };
  }),
  math: () => Promise.all([import("@streamdown/math"), import("katex/dist/katex.min.css")]).then(([math]) => {
    loadedPlugins = { ...loadedPlugins, math: math.math };
  }),
  mermaid: () => import("@streamdown/mermaid").then(({ mermaid }) => {
    loadedPlugins = { ...loadedPlugins, mermaid };
  }),
  cjk: () => import("@streamdown/cjk").then(({ cjk }) => {
    loadedPlugins = { ...loadedPlugins, cjk };
  }),
};

function useStreamdownPlugins(text: string) {
  const [plugins, setPlugins] = useState(loadedPlugins);
  const { code, math, mermaid, cjk } = markdownPlugins(text);
  useEffect(() => {
    const needed = { code, math, mermaid, cjk };
    const keys = (Object.keys(needed) as (keyof typeof needed)[]).filter((key) => needed[key]);
    let isCurrent = true;
    void Promise.all(keys.map((key) => pluginsLoading[key] ??= PLUGIN_LOADERS[key]())).then(
      () => isCurrent && setPlugins(loadedPlugins),
      (error: unknown) => console.error("Could not load markdown plugins", error),
    );
    return () => void (isCurrent = false);
  }, [code, math, mermaid, cjk]);
  return plugins;
}

export type MessageToolbarProps = ComponentProps<"div">;

export const MessageToolbar = ({
  className,
  children,
  ...props
}: MessageToolbarProps) => (
  <div
    className={cn(
      "mt-4 flex w-full items-center justify-between gap-4",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
