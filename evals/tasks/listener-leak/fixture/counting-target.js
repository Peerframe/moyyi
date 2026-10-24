// Test double for window and document.fonts: counts live listeners per event type.
export class CountingTarget {
  #listeners = new Map();

  addEventListener(type, listener) {
    const set = this.#listeners.get(type) ?? new Set();
    set.add(listener);
    this.#listeners.set(type, set);
  }

  removeEventListener(type, listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  count(type) {
    return this.#listeners.get(type)?.size ?? 0;
  }

  dispatch(type) {
    for (const listener of this.#listeners.get(type) ?? []) listener();
  }
}
