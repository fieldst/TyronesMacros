// services/apiClient.ts - unified, conflict-free

export type ApiResponse<T = any> = {
  success: boolean;
  data?: T;
  error?: string;
  details?: any;
};

// Overloads for DX (supports both styles)
export async function api<T = any>(
  path: string,
  body: any,
  init?: RequestInit,
  retries?: number
): Promise<ApiResponse<T>>;
export async function api<T = any>(
  path: string,
  init?: RequestInit,
  retries?: number
): Promise<ApiResponse<T>>;

// Implementation
export async function api<T = any>(
  path: string,
  arg2?: any,
  arg3?: any,
  arg4?: any
): Promise<ApiResponse<T>> {
  // Normalize args
  let body: any | undefined;
  let init: RequestInit | undefined;
  let retries = 1;

  // Determine which overload the caller used
  if (arg2 && typeof arg2 === 'object' && ('method' in arg2 || 'headers' in arg2 || 'body' in arg2)) {
    // api(path, init?, retries?)
    init = arg2 as RequestInit;
    if (typeof arg3 === 'number') retries = arg3;
  } else {
    // api(path, body, init?, retries?)
    body = arg2;
    if (arg3 && typeof arg3 === 'object') init = arg3 as RequestInit;
    if (typeof arg4 === 'number') retries = arg4;
  }

  // If body is provided and caller didn’t specify method, default to POST
  const method = init?.method ?? (body !== undefined ? 'POST' : 'GET');

  const requestInit: RequestInit = {
    ...init,
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    body: body !== undefined
      ? (init?.body ?? JSON.stringify(body))
      : init?.body,
  };

  // services/apiClient.ts
// ...inside the api() function, right after requestInit is created
const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
(requestInit.headers as any)['x-req-id'] = reqId;


  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(path, requestInit);

      let responseData: any;
      try {
        responseData = await res.json();
      } catch {
        responseData = { error: `HTTP ${res.status}: ${res.statusText}` };
      }

      if (res.ok) {
        // If the server already wraps as { success, data }, pass it through
        return responseData?.success !== undefined
          ? responseData
          : { success: true, data: responseData };
      }

      // 4xx: don't retry
      if (res.status >= 400 && res.status < 500) {
        return {
       success: false,
        error: responseData?.error || `Client error: ${res.status}`,
         details: { ...(responseData?.details || {}), reqId },
        };
      }

      // 5xx: retry
      lastError = new new Error(
  responseData?.error
    ? `${responseData.error} (reqId ${reqId})`
    : `Server error ${res.status} (reqId ${reqId})`
);
    } catch (error: any) {
      lastError = error;

      // Likely permanent network issue? Bail.
      if (error?.name === 'TypeError' && String(error?.message || '').includes('fetch')) {
        break;
      }
    }

    // Exponential backoff between retries
    if (attempt < retries) {
      const ms = Math.min(1000 * Math.pow(2, attempt), 5000);
      await new Promise((r) => setTimeout(r, ms));
    }
  }

  const isNetworkError =
    (lastError?.message && lastError.message.includes('fetch')) ||
    lastError?.name === 'TypeError' ||
    (typeof navigator !== 'undefined' && !navigator.onLine);

  return {
    success: false,
    error: isNetworkError
      ? 'Unable to connect. Please check your internet connection.'
      : lastError?.message || 'Service temporarily unavailable. Please try again.',
  };
}

// Convenience methods
export const apiClient = {
  get: <T>(path: string, init?: RequestInit) =>
    api<T>(path, { ...(init || {}), method: 'GET' }),
  post: <T>(path: string, data?: any, init?: RequestInit) =>
    api<T>(path, data, { ...(init || {}), method: 'POST' }),
  put: <T>(path: string, data?: any, init?: RequestInit) =>
    api<T>(path, data, { ...(init || {}), method: 'PUT' }),
  delete: <T>(path: string, init?: RequestInit) =>
    api<T>(path, { ...(init || {}), method: 'DELETE' } as RequestInit),
};

// Health check
export async function healthCheck(): Promise<boolean> {
  try {
    const response = await api('/api/health', { method: 'GET' });
    return !!response.success;
  } catch {
    return false;
  }
}
