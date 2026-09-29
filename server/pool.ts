export interface PoolReport<R> {
  results: R[];
  maxInFlight: number;
}

/**
 * Map paralelo com teto de concorrência ("máximo de concorrência simultâneo").
 * Preserva a ordem dos resultados; devolve também o pico de tarefas em voo
 * (usado nos testes e na telemetria para provar a paralelização real).
 */
export async function mapPool<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
): Promise<PoolReport<R>> {
  const n = items.length;
  const results = new Array<R>(n);
  let nextIndex = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= n) return;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        results[i] = await worker(items[i], i);
      } finally {
        inFlight--;
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, Math.max(n, 1))) }, runWorker);
  await Promise.all(workers);
  return { results, maxInFlight };
}
