import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../api/client';

/** Loads data on mount and exposes `reload`; keeps previous data visible while reloading. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const load = useCallback(loader, deps);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await load();
      setData(next);
      setError(null);
      return next;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}
