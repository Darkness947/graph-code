import { createContext, useContext } from 'react';

/**
 * Canvas actions that nodes and edges call. They go through the canvas, not straight to the
 * store, so the canvas knows which folder to keep in view after it moves (spec 8.6 item 6).
 * @type {import('react').Context<{ toggleFolder: (path: string, nodeId: string) => void }>}
 */
export const CanvasActions = createContext({ toggleFolder: () => {} });

export const useCanvasActions = () => useContext(CanvasActions);
