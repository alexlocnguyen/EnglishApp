export type ApiErrorKind = 'network' | 'http' | 'invalid-response' | 'configuration' | 'client';

export type ApiRequestOptions = {
  networkMessage?: string;
  httpErrorMessage?: string;
  invalidResponseMessage?: string;
};

export class ApiServiceError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiServiceError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
    || isRecord(error) && error.name === 'AbortError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const detail = payload.detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const messages = detail.flatMap((item) => isRecord(item) && typeof item.msg === 'string' ? [item.msg.trim()] : []);
    if (messages.length) return messages.join(' ');
  }
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim();
  return undefined;
}

/** Fetch an API response, normalizing transport and HTTP errors while preserving successful bodies. */
export async function requestResponse(
  url: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiServiceError(options.networkMessage ?? 'Không thể kết nối máy chủ. Hãy kiểm tra mạng và thử lại.', 'network');
  }

  if (!response.ok) {
    let payload: unknown;
    try { payload = await response.clone().json(); } catch { payload = null; }
    throw new ApiServiceError(
      errorMessage(payload) ?? `${options.httpErrorMessage ?? 'Máy chủ không thể xử lý yêu cầu.'} (${response.status}).`,
      'http',
      response.status,
    );
  }
  return response;
}

/** Fetch and decode a JSON API response, normalizing malformed-response errors. */
export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {},
): Promise<T> {
  const response = await requestResponse(url, init, options);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (payload === null) {
    throw new ApiServiceError(options.invalidResponseMessage ?? 'Máy chủ trả về dữ liệu không đúng định dạng.', 'invalid-response', response.status);
  }
  return payload as T;
}
