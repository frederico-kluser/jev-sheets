import "@testing-library/jest-dom/vitest";

// jsdom não implementa ResizeObserver (a AG Grid precisa dele em testes de UI).
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
