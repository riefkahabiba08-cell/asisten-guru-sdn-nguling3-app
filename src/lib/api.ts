export interface ParsedApiResponse<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T | null;
  errorMessage: string | null;
  errorCode: string | null;
}

export async function fetchApiJson<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
): Promise<ParsedApiResponse<T>> {
  try {
    const res = await fetch(url, init);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        status: res.status,
        data: null,
        errorMessage: `Server merespons status ${res.status} (bukan JSON). Pastikan server aplikasi sedang aktif.`,
        errorCode: 'NON_JSON_RESPONSE',
      };
    }

    const data = (await res.json()) as T & { error?: string; code?: string };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        data,
        errorMessage: data?.error || `Permintaan gagal dengan status ${res.status}.`,
        errorCode: data?.code || null,
      };
    }

    return {
      ok: true,
      status: res.status,
      data,
      errorMessage: null,
      errorCode: null,
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error
        ? err.message
        : 'Tidak dapat terhubung ke server aplikasi.';
    return {
      ok: false,
      status: 0,
      data: null,
      errorMessage: `Gagal terhubung ke server (${msg}).`,
      errorCode: 'NETWORK_ERROR',
    };
  }
}
