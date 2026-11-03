// The material under the sidebar's strip of the window, below the page, so the page keeps its own opaque colours:
// a flat colour over Electron's `vibrancy` before macOS 26, or with `glass` an NSGlassEffectView tinted that colour on
// macOS 26, where AppKit's sidebar glass (electron/sidebarGlass) isn't used yet. One view per NSWindow.
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#include <cmath>

// N-API is a stable C ABI, declared here so the build needs no Node headers; the symbols resolve from Electron at load.
extern "C" {
typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef int napi_status;
typedef napi_value (*napi_callback)(napi_env, napi_callback_info);
napi_status napi_get_cb_info(napi_env, napi_callback_info, size_t *, napi_value *, napi_value *, void **);
napi_status napi_get_buffer_info(napi_env, napi_value, void **, size_t *);
napi_status napi_get_named_property(napi_env, napi_value, const char *, napi_value *);
napi_status napi_get_value_double(napi_env, napi_value, double *);
napi_status napi_get_value_bool(napi_env, napi_value, bool *);
napi_status napi_get_boolean(napi_env, bool, napi_value *);
napi_status napi_is_array(napi_env, napi_value, bool *);
napi_status napi_get_array_length(napi_env, napi_value, uint32_t *);
napi_status napi_get_element(napi_env, napi_value, uint32_t, napi_value *);
napi_status napi_get_undefined(napi_env, napi_value *);
napi_status napi_throw_type_error(napi_env, const char *, const char *);
napi_status napi_throw_error(napi_env, const char *, const char *);
napi_status napi_create_function(napi_env, const char *, size_t, napi_callback, void *, napi_value *);
napi_status napi_set_named_property(napi_env, napi_value, const char *, napi_value);
}

@interface MochiSidebarTintView : NSView
@end

@implementation MochiSidebarTintView
// Clicks belong to the page, even if Chromium ever re-sorts this view above it.
- (NSView *)hitTest:(NSPoint)point {
  return nil;
}
@end

API_AVAILABLE(macos(26.0))
@interface MochiSidebarGlassView : NSGlassEffectView
@end

@implementation MochiSidebarGlassView
- (NSView *)hitTest:(NSPoint)point {
  return nil;
}
@end

static const void *kTintKey = &kTintKey;

// Electron's effect view isn't API and its place differs between versions: in the content view or beside it.
// Nil when there's none, and the tint falls back to the bottom of the window, under the page.
static NSView *effectViewOf(NSView *root) {
  NSMutableArray<NSView *> *parents = [NSMutableArray arrayWithObject:root];
  if (root.superview) [parents addObject:root.superview];
  for (NSView *parent in parents)
    for (NSView *view in parent.subviews)
      if ([view isKindOfClass:NSVisualEffectView.class]) return view;
  return nil;
}

// Re-placed on every call: Chromium re-sorts the content view's subviews when a child WebContentsView comes or goes.
static void place(NSView *tint, NSView *root) {
  NSView *effect = effectViewOf(root);
  NSView *parent = effect ? effect.superview : (root.superview ?: root);
  NSView *anchor = effect ?: (parent == root ? nil : root);
  NSArray<NSView *> *siblings = parent.subviews;
  NSUInteger at = [siblings indexOfObjectIdenticalTo:tint];
  NSUInteger anchorAt = anchor ? [siblings indexOfObjectIdenticalTo:anchor] : NSNotFound;
  BOOL isPlaced = effect ? at != NSNotFound && at == anchorAt + 1
                         : at != NSNotFound && (anchor ? at + 1 == anchorAt : at == 0);
  if (isPlaced) return;
  [parent addSubview:tint positioned:(effect ? NSWindowAbove : NSWindowBelow) relativeTo:anchor];
}

static bool readHandle(napi_env env, napi_value value, NSView *__strong *root) {
  void *data = nullptr;
  size_t length = 0;
  if (napi_get_buffer_info(env, value, &data, &length) != 0 || length != sizeof(void *)) {
    napi_throw_type_error(env, nullptr, "handle must be BrowserWindow.getNativeWindowHandle()");
    return false;
  }
  *root = *reinterpret_cast<NSView *__unsafe_unretained *>(data);
  if (!*root || !(*root).window) {
    napi_throw_type_error(env, nullptr, "handle is not a view in a window");
    return false;
  }
  return true;
}

static bool readNumber(napi_env env, napi_value value, double min, double max, double *out) {
  return napi_get_value_double(env, value, out) == 0 && std::isfinite(*out) && *out >= min && *out <= max;
}

static bool isMainThread(napi_env env) {
  if (NSThread.isMainThread) return true;
  napi_throw_error(env, nullptr, "sidebar tint must be called from the main thread");
  return false;
}

static bool isGlassAvailable() {
  if (@available(macOS 26, *)) return true;
  return false;
}

// A new view when there's none yet or the wrong kind for `isGlass`.
static NSView *tintViewFor(NSWindow *window, bool isGlass) {
  NSView *tint = objc_getAssociatedObject(window, kTintKey);
  bool isGlassView = false;
  if (@available(macOS 26, *)) isGlassView = [tint isKindOfClass:MochiSidebarGlassView.class];
  if (tint && isGlassView == isGlass) return tint;
  [tint removeFromSuperview];
  if (@available(macOS 26, *)) {
    if (isGlass) {
      MochiSidebarGlassView *glass = [MochiSidebarGlassView new];
      glass.cornerRadius = 0;
      tint = glass;
    }
  }
  if (!isGlass) tint = [MochiSidebarTintView new];
  tint.wantsLayer = YES;
  tint.autoresizingMask = NSViewHeightSizable;
  objc_setAssociatedObject(window, kTintKey, tint, OBJC_ASSOCIATION_RETAIN);
  return tint;
}

// setSidebarTint(handle, { width, rgba: [r, g, b, a], glass? }): width in points, colour components 0–1 in sRGB.
static napi_value setSidebarTint(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  if (!isMainThread(env)) return nullptr;
  if (argc < 2) {
    napi_throw_type_error(env, nullptr, "setSidebarTint(handle, { width, rgba })");
    return nullptr;
  }
  napi_value widthValue, rgbaValue;
  double width;
  if (napi_get_named_property(env, args[1], "width", &widthValue) != 0 ||
      !readNumber(env, widthValue, 0, 100000, &width)) {
    napi_throw_type_error(env, nullptr, "width must be a finite number ≥ 0");
    return nullptr;
  }
  bool isArray = false;
  uint32_t length = 0;
  double rgba[4];
  bool isValid = napi_get_named_property(env, args[1], "rgba", &rgbaValue) == 0 &&
                 napi_is_array(env, rgbaValue, &isArray) == 0 && isArray &&
                 napi_get_array_length(env, rgbaValue, &length) == 0 && length == 4;
  for (uint32_t i = 0; isValid && i < 4; i++) {
    napi_value component;
    isValid = napi_get_element(env, rgbaValue, i, &component) == 0 && readNumber(env, component, 0, 1, &rgba[i]);
  }
  if (!isValid) {
    napi_throw_type_error(env, nullptr, "rgba must be four numbers from 0 to 1");
    return nullptr;
  }
  napi_value glassValue;
  bool isGlass = false;
  if (napi_get_named_property(env, args[1], "glass", &glassValue) == 0 &&
      napi_get_value_bool(env, glassValue, &isGlass) != 0)
    isGlass = false;
  if (isGlass && !isGlassAvailable()) {
    napi_throw_error(env, nullptr, "glass needs macOS 26 or later");
    return nullptr;
  }
  NSView *root = nil;
  if (!readHandle(env, args[0], &root)) return nullptr;

  NSView *tint = tintViewFor(root.window, isGlass);
  place(tint, root);
  NSRect area = tint.superview == root ? root.bounds : root.frame;
  NSColor *color = [NSColor colorWithSRGBRed:rgba[0] green:rgba[1] blue:rgba[2] alpha:rgba[3]];
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  tint.frame = NSMakeRect(area.origin.x, area.origin.y, width, area.size.height);
  if (@available(macOS 26, *)) {
    if (isGlass) ((MochiSidebarGlassView *)tint).tintColor = color;
  }
  if (!isGlass) tint.layer.backgroundColor = color.CGColor;
  [CATransaction commit];
  return undefined;
}

// clearTint(handle): removes that window's tint.
static napi_value clearTint(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value handle;
  napi_get_cb_info(env, info, &argc, &handle, nullptr, nullptr);
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  if (!isMainThread(env)) return nullptr;
  NSView *root = nil;
  if (argc < 1 || !readHandle(env, handle, &root)) {
    if (argc < 1) napi_throw_type_error(env, nullptr, "clearTint(handle)");
    return nullptr;
  }
  NSView *tint = objc_getAssociatedObject(root.window, kTintKey);
  [tint removeFromSuperview];
  objc_setAssociatedObject(root.window, kTintKey, nil, OBJC_ASSOCIATION_RETAIN);
  return undefined;
}

// isGlassSupported(): whether `glass` can be asked for, macOS 26 and later.
static napi_value isGlassSupported(napi_env env, napi_callback_info) {
  napi_value result;
  napi_get_boolean(env, isGlassAvailable(), &result);
  return result;
}

extern "C" __attribute__((visibility("default"))) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "isGlassSupported", SIZE_MAX, isGlassSupported, nullptr, &fn);
  napi_set_named_property(env, exports, "isGlassSupported", fn);
  napi_create_function(env, "setSidebarTint", SIZE_MAX, setSidebarTint, nullptr, &fn);
  napi_set_named_property(env, exports, "setSidebarTint", fn);
  napi_create_function(env, "clearTint", SIZE_MAX, clearTint, nullptr, &fn);
  napi_set_named_property(env, exports, "clearTint", fn);
  return exports;
}
