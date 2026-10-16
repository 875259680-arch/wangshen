// Disabled until evidence from a real page establishes detection and selectors.
(() => {
  window.__afPage.register({
    id: '__ID__',
    detect: () => false,
    list: () => [], // TODO: stable key, section, row, raw value, options, validationError.
    writeMany: async items => items.map(x => ({ key: x.key, ok: false, error: '尚未实现控件操作' })),
    focus: () => false,
    mark: () => {},
  });
})();
