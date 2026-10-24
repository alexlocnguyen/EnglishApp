import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { ApiServiceError, requestJson } from './api-errors';
import type { AuthProvider, AuthUser } from './auth-provider';

const SESSION_KEY = 'elevate.session';
const configuredBaseUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '');

function getApiBaseUrl(): string {
  if (!configuredBaseUrl) throw new Error('Chưa cấu hình địa chỉ backend trong EXPO_PUBLIC_API_URL.');
  if (Platform.OS === 'web' || !__DEV__) return configuredBaseUrl;

  try {
    const configured = new URL(configuredBaseUrl);
    if (configured.hostname !== 'localhost' && configured.hostname !== '127.0.0.1') return configuredBaseUrl;
    const hostUri = Constants.expoConfig?.hostUri;
    if (!hostUri) return configuredBaseUrl;
    const host = new URL(`http://${hostUri}`).hostname;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !host.startsWith('127.')) return `http://${host}:8000`;
  } catch {
    // The backend request will provide the useful configuration/network error.
  }
  return configuredBaseUrl;
}

type AuthResponse = { user?: AuthUser; session_token?: string; detail?: string };
let sessionToken: string | null = null;
let currentUser: AuthUser | null = null;
let restorePromise: Promise<void> | undefined;
let generation = 0;
const listeners = new Set<(user: AuthUser | null) => void>();

function publish(user: AuthUser | null) {
  currentUser = user;
  listeners.forEach((listener) => {
    try {
      listener(user);
    } catch (error) {
      console.error('[auth] User session listener failed.', error);
    }
  });
}

async function request(path: string, body?: Record<string, string>, method = 'POST'): Promise<AuthResponse> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-Elevate-Client': Platform.OS === 'web' ? 'web' : 'native' };
  if (body) headers['Content-Type'] = 'application/json';
  if (Platform.OS !== 'web' && sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  const data = await requestJson<AuthResponse>(`${getApiBaseUrl()}/api/auth${path}`, {
      method,
      headers,
      credentials: Platform.OS === 'web' ? 'include' : 'omit',
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    { networkMessage: 'NETWORK_REQUEST_FAILED', httpErrorMessage: 'AUTH_REQUEST_FAILED' },
  );
  return data;
}

export async function requestLearningApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (Platform.OS !== 'web' && !sessionToken) {
    restorePromise ??= restoreSession();
    await restorePromise;
  }
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Elevate-Client': Platform.OS === 'web' ? 'web' : 'native',
    ...(init.body && !(typeof FormData !== 'undefined' && init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (Platform.OS !== 'web' && sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  return requestJson<T>(`${getApiBaseUrl()}/api/learning${path}`, {
    ...init,
    headers,
    credentials: Platform.OS === 'web' ? 'include' : 'omit',
  }, { networkMessage: 'NETWORK_REQUEST_FAILED', httpErrorMessage: 'LEARNING_REQUEST_FAILED' });
}

async function acceptSession(data: AuthResponse) {
  if (!data.user) throw new Error('Backend không trả về thông tin tài khoản.');
  if (Platform.OS !== 'web') {
    if (!data.session_token) throw new Error('Backend không trả về mã phiên bảo mật.');
    sessionToken = data.session_token;
    try {
      await SecureStore.setItemAsync(SESSION_KEY, sessionToken);
    } catch {
      await request('/logout').catch(() => undefined);
      sessionToken = null;
      throw new Error('SECURE_SESSION_STORAGE_FAILED');
    }
  }
  generation += 1;
  publish(data.user);
  return data.user;
}

async function restoreSession() {
  const savedGeneration = generation;
  try {
    if (Platform.OS !== 'web') sessionToken = await SecureStore.getItemAsync(SESSION_KEY);
    const data = await request('/session', undefined, 'GET');
    if (generation === savedGeneration) publish(data.user ?? null);
  } catch {
    if (generation === savedGeneration) {
      sessionToken = null;
      if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => undefined);
      publish(null);
    }
  }
}

function observeUser(onChange: (user: AuthUser | null) => void) {
  listeners.add(onChange);
  if (currentUser) {
    try {
      onChange(currentUser);
    } catch (error) {
      console.error('[auth] User session listener failed.', error);
    }
  }
  restorePromise ??= restoreSession();
  return () => listeners.delete(onChange);
}

async function register(email: string, password: string, displayName: string) {
  return acceptSession(await request('/register', { email: email.trim(), password, display_name: displayName.trim() }));
}

async function login(email: string, password: string) {
  return acceptSession(await request('/login', { email: email.trim(), password }));
}

async function requestPasswordReset(email: string) {
  await request('/password-reset', { email: email.trim() });
}

async function logout() {
  try {
    await request('/logout');
  } catch {
    // Always clear the local credential, even if the backend is temporarily unavailable.
  } finally {
    generation += 1;
    sessionToken = null;
    if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(SESSION_KEY).catch(() => undefined);
    publish(null);
  }
}

function getErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const errors: Record<string, string> = {
    EMAIL_EXISTS: 'Email này đã được đăng ký.',
    INVALID_EMAIL: 'Địa chỉ email chưa hợp lệ.',
    WEAK_PASSWORD: 'Mật khẩu cần có ít nhất 6 ký tự.',
    INVALID_LOGIN_CREDENTIALS: 'Email hoặc mật khẩu không chính xác.',
    EMAIL_NOT_FOUND: 'Email hoặc mật khẩu không chính xác.',
    INVALID_PASSWORD: 'Email hoặc mật khẩu không chính xác.',
    USER_DISABLED: 'Tài khoản này đã bị vô hiệu hóa.',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'Bạn thử quá nhiều lần. Hãy chờ một chút rồi thử lại.',
    OPERATION_NOT_ALLOWED: 'Email/mật khẩu chưa được bật trong Firebase Authentication.',
    CONFIGURATION_NOT_FOUND: 'Firebase Authentication chưa được khởi tạo cho project. Hãy mở Authentication trong Firebase Console và chọn Get started.',
    FIREBASE_AUTH_NOT_CONFIGURED: 'Backend chưa được cấu hình Firebase Authentication.',
    AUTH_ORIGIN_NOT_ALLOWED: 'Địa chỉ ứng dụng chưa được cho phép trong cấu hình backend CORS_ORIGINS.',
    AUTH_SESSION_NOT_CONFIGURED: 'Backend chưa được cấu hình mã hóa phiên. Kiểm tra AUTH_SESSION_ENCRYPTION_KEY.',
    NETWORK_REQUEST_FAILED: 'Không thể kết nối backend. Hãy kiểm tra mạng và địa chỉ API.',
    SECURE_SESSION_STORAGE_FAILED: 'Không thể lưu phiên đăng nhập an toàn trên thiết bị.',
  };
  if (error instanceof ApiServiceError && error.kind === 'network') return errors[error.message] ?? 'Không thể kết nối backend. Hãy kiểm tra mạng và địa chỉ API.';
  if (errors[message]) return errors[message];
  if (message && !/^[A-Z0-9_:-]+$/.test(message)) return message;
  return message.startsWith('FIREBASE_') ? 'Firebase không thể xác thực yêu cầu. Hãy kiểm tra cấu hình Authentication.' : 'Không thể xác thực lúc này. Vui lòng thử lại.';
}

export const bffAuthProvider: AuthProvider = { observeUser, register, login, requestPasswordReset, logout, getErrorMessage };
