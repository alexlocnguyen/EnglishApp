type ApiErrorKind = 'network' | 'http' | 'invalid-response';

type ApiRequestOptions = {
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
  }
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

/** Fetch and decode a JSON API response, normalizing network, HTTP, and malformed-response errors. */
export async function requestJson<T>(
  url: string,
  init: RequestInit,
  options: ApiRequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (isRecord(error) && error.name === 'AbortError') throw error;
    throw new ApiServiceError(options.networkMessage ?? 'Không thể kết nối máy chủ. Hãy kiểm tra mạng và thử lại.', 'network');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ApiServiceError(
      errorMessage(payload) ?? `${options.httpErrorMessage ?? 'Máy chủ không thể xử lý yêu cầu.'} (${response.status}).`,
      'http',
      response.status,
    );
  }
  if (payload === null) {
    throw new ApiServiceError(options.invalidResponseMessage ?? 'Máy chủ trả về dữ liệu không đúng định dạng.', 'invalid-response', response.status);
  }
  return payload as T;
}
