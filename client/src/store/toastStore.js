import { create } from 'zustand';

/**
 * The single app toast. `id` changes on every `showToast`, so showing the same message twice
 * restarts the timer.
 */
export const useToastStore = create(() => ({ message: null, id: 0 }));

/** Shows a short message in the app toast. Callable from anywhere, including outside React. */
export function showToast(message) {
  useToastStore.setState((s) => ({ message, id: s.id + 1 }));
}

export function dismissToast() {
  useToastStore.setState({ message: null });
}
