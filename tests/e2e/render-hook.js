// Installed before React loads, in place of React DevTools: counts the components each commit rendered.
// A subtree whose child is the same fiber as last commit was skipped, so its PerformedWork flags are stale and it isn't walked.
window.__perf = { renders: 0, commits: 0, isCounting: false };
window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
  supportsFiber: true,
  renderers: new Map(),
  inject: () => 1,
  checkDCE() {},
  onScheduleFiberRoot() {},
  onCommitFiberUnmount() {},
  onPostCommitFiberRoot() {},
  onCommitFiberRoot(_id, root) {
    const perf = window.__perf;
    if (!perf.isCounting) return;
    perf.commits++;
    const walk = (fiber) => {
      for (let f = fiber; f; f = f.sibling) {
        // PerformedWork
        if (f.flags & 1) perf.renders++;
        if (!f.alternate || f.child !== f.alternate.child) walk(f.child);
      }
    };
    walk(root.current.child);
  },
};
