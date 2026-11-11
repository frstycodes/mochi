// macOS's own glass under the shell window's sidebar, placed the way Claude's desktop app places it: a holder view at the
// bottom of the window's content view, a strip down its left edge, over the theme's colour. The page stays opaque except
// over its sidebar (`data-material` in index.css).
#import <AppKit/AppKit.h>
#import <objc/runtime.h>

// N-API is a stable C ABI, declared here so the build needs no Node headers; the symbols resolve from Electron at load.
extern "C" {
typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef int napi_status;
typedef napi_value (*napi_callback)(napi_env, napi_callback_info);
napi_status napi_get_cb_info(napi_env, napi_callback_info, size_t *, napi_value *, napi_value *, void **);
napi_status napi_get_buffer_info(napi_env, napi_value, void **, size_t *);
napi_status napi_get_value_bool(napi_env, napi_value, bool *);
napi_status napi_get_value_uint32(napi_env, napi_value, uint32_t *);
napi_status napi_get_boolean(napi_env, bool, napi_value *);
napi_status napi_create_function(napi_env, const char *, size_t, napi_callback, void *, napi_value *);
napi_status napi_set_named_property(napi_env, napi_value, const char *, napi_value);
}

static const void *kHolderKey = &kHolderKey;
static const void *kSplitKey = &kSplitKey;
static NSHashTable<NSView *> *holders;

// Chromium re-sorts the content view's subviews when its own views change (a browser pane opening), which can lift the
// glass over the page. After every main run loop pass, any holder that isn't the bottom subview goes back under.
static void keepHoldersUnder() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    holders = [NSHashTable weakObjectsHashTable];
    CFRunLoopObserverRef observer = CFRunLoopObserverCreateWithHandler(
        kCFAllocatorDefault, kCFRunLoopBeforeWaiting, true, 0, ^(CFRunLoopObserverRef, CFRunLoopActivity) {
          for (NSView *holder in holders.allObjects) {
            NSView *parent = holder.superview;
            if (parent && parent.subviews.firstObject != holder)
              [parent addSubview:holder positioned:NSWindowBelow relativeTo:nil];
          }
        });
    CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
  });
}

// AppKit's sidebar (macOS 27+): one sidebar item, held at `width`, in a split view; it draws the material Finder's sidebar has.
static NSView *appKitSidebar(NSView *holder, CGFloat width) {
  NSViewController *sidebar = [NSViewController new];
  sidebar.view = [NSView new];
  NSSplitViewItem *item = [NSSplitViewItem sidebarWithViewController:sidebar];
  item.canCollapse = NO;
  item.springLoaded = NO;
  // Lowered before raised, so the minimum never passes the maximum on the way.
  item.minimumThickness = MIN(width, item.minimumThickness);
  item.maximumThickness = width;
  item.minimumThickness = width;
  NSSplitViewController *split = [NSSplitViewController new];
  [split addSplitViewItem:item];
  split.view.accessibilityElement = NO;
  split.view.accessibilityChildren = @[];
  objc_setAssociatedObject(holder, kSplitKey, split, OBJC_ASSOCIATION_RETAIN);
  return split.view;
}

// show(BrowserWindow.getNativeWindowHandle(), isAppKitSidebar, 0xRRGGBB, width): true once a strip of glass `width`
// points wide is under the page, over that colour; false before macOS 26. Called again, it swaps in fresh glass.
static napi_value show(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value args[4];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  void *data = nullptr;
  size_t length = 0;
  napi_get_buffer_info(env, args[0], &data, &length);
  bool isAppKitSidebar = false;
  if (argc > 1) napi_get_value_bool(env, args[1], &isAppKitSidebar);
  uint32_t rgb = 0;
  if (argc > 2) napi_get_value_uint32(env, args[2], &rgb);
  uint32_t width = 0;
  if (argc > 3) napi_get_value_uint32(env, args[3], &width);
  bool isShown = false;
  if (@available(macOS 26, *)) {
    NSView *root = length == sizeof(void *) ? *reinterpret_cast<NSView *__unsafe_unretained *>(data) : nil;
    NSWindow *window = root.window;
    NSView *content = window.contentView;
    if (content) {
      keepHoldersUnder();
      NSView *old = objc_getAssociatedObject(window, kHolderKey);
      // Claude's geometry: a strip down the window's left edge, `width` wide, that follows the window's height only.
      NSView *holder = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, MIN(width, NSWidth(content.bounds)), NSHeight(content.bounds))];
      holder.autoresizingMask = NSViewHeightSizable;
      NSView *glass;
      if (isAppKitSidebar) {
        glass = appKitSidebar(holder, NSWidth(holder.bounds));
      } else {
        NSGlassEffectView *plain = [[NSGlassEffectView alloc] initWithFrame:holder.bounds];
        plain.cornerRadius = 0;
        glass = plain;
      }
      glass.frame = holder.bounds;
      glass.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      [holder addSubview:glass];
      [content addSubview:holder positioned:NSWindowBelow relativeTo:nil];
      [old removeFromSuperview];
      // The theme's own colour behind the glass, as Claude does. A cleared window also showed the windows behind,
      // blurred, like `vibrancy`; the system's window colour gave the glass a blue cast the page beside it doesn't have.
      window.opaque = NO;
      window.backgroundColor = [NSColor colorWithSRGBRed:(rgb >> 16 & 0xff) / 255.0
                                                   green:(rgb >> 8 & 0xff) / 255.0
                                                    blue:(rgb & 0xff) / 255.0
                                                   alpha:1];
      objc_setAssociatedObject(window, kHolderKey, holder, OBJC_ASSOCIATION_RETAIN);
      [holders addObject:holder];
      isShown = true;
    }
  }
  napi_value result;
  napi_get_boolean(env, isShown, &result);
  return result;
}

extern "C" __attribute__((visibility("default"))) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "show", SIZE_MAX, show, nullptr, &fn);
  napi_set_named_property(env, exports, "show", fn);
  return exports;
}
