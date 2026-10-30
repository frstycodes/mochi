// AppKit's own sidebar glass (macOS 26+) under the window's web contents, like Finder's sidebar: it glows with the
// wallpaper under the window and never shows the windows behind it, unlike Electron's `vibrancy`, which blurs them.
// One sidebar item spans the whole window, so nothing tracks the sidebar's width: the page stays opaque outside it.
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
napi_status napi_get_boolean(napi_env, bool, napi_value *);
napi_status napi_create_function(napi_env, const char *, size_t, napi_callback, void *, napi_value *);
napi_status napi_set_named_property(napi_env, napi_value, const char *, napi_value);
}

static const void *kSplitKey = &kSplitKey;

// attach(BrowserWindow.getNativeWindowHandle()): true once the glass is in place, false before macOS 26.
static napi_value attach(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value handle;
  napi_get_cb_info(env, info, &argc, &handle, nullptr, nullptr);
  void *data = nullptr;
  size_t length = 0;
  napi_get_buffer_info(env, handle, &data, &length);
  bool isAttached = false;
  if (@available(macOS 26, *)) {
    NSView *root = length == sizeof(void *) ? *reinterpret_cast<NSView *__unsafe_unretained *>(data) : nil;
    isAttached = root && objc_getAssociatedObject(root, kSplitKey);
    if (root && !isAttached) {
      NSViewController *sidebar = [NSViewController new];
      sidebar.view = [NSView new];
      NSSplitViewController *split = [NSSplitViewController new];
      [split addSplitViewItem:[NSSplitViewItem sidebarWithViewController:sidebar]];
      split.view.frame = root.frame;
      split.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      // A sibling under the content view, not inside it: Chromium re-sorts the content view's subviews whenever a child
      // WebContentsView (the browser pane) comes or goes, and puts views it doesn't own on top, over the whole page.
      [root.superview addSubview:split.view positioned:NSWindowBelow relativeTo:root];
      objc_setAssociatedObject(root, kSplitKey, split, OBJC_ASSOCIATION_RETAIN);
      isAttached = true;
    }
  }
  napi_value result;
  napi_get_boolean(env, isAttached, &result);
  return result;
}

extern "C" __attribute__((visibility("default"))) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "attach", SIZE_MAX, attach, nullptr, &fn);
  napi_set_named_property(env, exports, "attach", fn);
  return exports;
}
