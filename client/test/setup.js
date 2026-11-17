import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// React Flow measures its container and nodes; jsdom has no layout, so give elements a size
// and provide the browser APIs it relies on. Node-environment test files skip this.
if (typeof HTMLElement !== 'undefined') {
  class ResizeObserverStub {
    constructor(callback) {
      this.callback = callback;
    }
    observe(target) {
      this.callback([{ target, contentRect: target.getBoundingClientRect() }], this);
    }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver ??= ResizeObserverStub;

  globalThis.DOMMatrixReadOnly ??= class {
    constructor(transform) {
      const scale = /scale\(([\d.]+)\)/.exec(transform ?? '');
      this.m22 = scale ? Number(scale[1]) : 1;
    }
  };

  for (const [prop, size] of [
    ['offsetWidth', 1280],
    ['offsetHeight', 720],
  ]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => size });
  }
}
