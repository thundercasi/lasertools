import { useState, useEffect, type Dispatch, type SetStateAction } from 'react';

// Like useSessionState, but backed by localStorage so the value survives
// closing the browser/tab — used where we want to remember the last
// values the user filled in across visits (e.g. the Pedidos simulator).
export function useLocalState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved !== null ? (JSON.parse(saved) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // ignore quota errors
    }
  }, [key, state]);

  return [state, setState];
}
