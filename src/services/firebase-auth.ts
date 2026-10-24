import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AuthProvider, AuthUser } from './auth-provider';

const IDENTITY_API = 'https://identitytoolkit.googleapis.com/v1/accounts';
const TOKEN_API = 'https://securetoken.googleapis.com/v1/token';
const SESSION_KEY = 'elevate.firebase.session';

type FirebaseResponse = {
  localId?: string;
  idToken?: string;
  refreshToken?: string;
  email?: string;
  displayName?: string;
  expiresIn?: string;
  user_id?: string;
  id_token?: string;
  refresh_token?: string;
  error?: { message?: string };
  users?: { localId?: string; email?: string; displayName?: string }[];
};

function getApiKey() {
  const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY?.trim();
  if (!apiKey) throw new Error('Thiếu cấu hình Firebase. Hãy thêm EXPO_PUBLIC_FIREBASE_API_KEY vào tệp .env.');
  return apiKey;
}

async function requestFirebase(url: string, body: Record<string, string | boolean>) {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error('NETWORK_REQUEST_FAILED'), { code: 'auth/network-request-failed' });
  }

  const data = await response.json().catch(() => ({})) as FirebaseResponse;
  if (!response.ok) {
    const code = data.error?.message ?? 'UNKNOWN';
    throw Object.assign(new Error(code), { code: firebaseErrorCode(code) });
  }
  return data;
}

function firebaseErrorCode(message: string) {
  const codes: Record<string, string> = {
    EMAIL_EXISTS: 'auth/email-already-in-use',
    INVALID_EMAIL: 'auth/invalid-email',
    WEAK_PASSWORD: 'auth/weak-password',
    EMAIL_NOT_FOUND: 'auth/invalid-credential',
    INVALID_PASSWORD: 'auth/invalid-credential',
    INVALID_LOGIN_CREDENTIALS: 'auth/invalid-credential',
    USER_DISABLED: 'auth/user-disabled',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'auth/too-many-requests',
    OPERATION_NOT_ALLOWED: 'auth/operation-not-allowed',
    CONFIGURATION_NOT_FOUND: 'auth/configuration-not-found',
    INVALID_ARGUMENT: 'auth/invalid-request',
    PROJECT_NOT_FOUND: 'auth/invalid-api-key',
    API_KEY_INVALID: 'auth/invalid-api-key',
    INVALID_API_KEY: 'auth/invalid-api-key',
  };
  return codes[message.split(' :')[0]] ?? 'auth/unknown';
}

const listeners = new Set<(user: AuthUser | null) => void>();
let currentUser: AuthUser | null = null;
let restorePromise: Promise<void> | undefined;
let authGeneration = 0;

function publish(user: AuthUser | null) {
  currentUser = user;
  listeners.forEach((listener) => listener(user));
}

async function saveUser(user: AuthUser) {
  authGeneration += 1;
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(user));
  publish(user);
}

async function lookupUser(idToken: string) {
  const result = await requestFirebase(`${IDENTITY_API}:lookup?key=${encodeURIComponent(getApiKey())}`, { idToken });
  return result.users?.[0];
}

async function refreshFirebaseToken(refreshToken: string) {
  let response: Response;
  try {
    response = await fetch(`${TOKEN_API}?key=${encodeURIComponent(getApiKey())}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });
  } catch {
    throw new Error('NETWORK_REQUEST_FAILED');
  }
  const data = await response.json().catch(() => ({})) as FirebaseResponse;
  if (!response.ok) throw new Error(data.error?.message ?? 'TOKEN_REFRESH_FAILED');
  return data;
}

async function makeUser(data: FirebaseResponse, displayName?: string) {
  if (!data.idToken || !data.refreshToken || !data.localId || !data.email) {
    throw new Error('Firebase không trả về đủ thông tin tài khoản.');
  }
  const remoteProfile = await lookupUser(data.idToken).catch(() => undefined);
  return {
    uid: data.localId,
    email: data.email,
    displayName: displayName ?? remoteProfile?.displayName ?? data.displayName ?? '',
    idToken: data.idToken,
    refreshToken: data.refreshToken,
  } satisfies AuthUser;
}

async function restoreSession() {
  const generation = authGeneration;
  try {
    const stored = await AsyncStorage.getItem(SESSION_KEY);
    if (!stored) {
      if (authGeneration === generation) publish(null);
      return;
    }
    const previous = JSON.parse(stored) as AuthUser;
    const refreshed = await refreshFirebaseToken(previous.refreshToken);
    if (authGeneration !== generation) return;
    const user: AuthUser = {
      uid: refreshed.user_id ?? previous.uid,
      email: refreshed.email ?? previous.email,
      displayName: previous.displayName,
      idToken: refreshed.id_token ?? previous.idToken,
      refreshToken: refreshed.refresh_token ?? previous.refreshToken,
    };
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(user));
    publish(user);
  } catch {
    if (authGeneration === generation) publish(null);
  }
}

export function observeFirebaseUser(onChange: (user: AuthUser | null) => void) {
  listeners.add(onChange);
  if (currentUser) onChange(currentUser);
  restorePromise ??= restoreSession();
  void restorePromise.then(() => onChange(currentUser));
  return () => {
    listeners.delete(onChange);
  };
}

export async function registerWithEmail(email: string, password: string, displayName: string) {
  const apiKey = encodeURIComponent(getApiKey());
  const created = await requestFirebase(`${IDENTITY_API}:signUp?key=${apiKey}`, {
    email: email.trim(), password, returnSecureToken: true,
  });
  const named = await requestFirebase(`${IDENTITY_API}:update?key=${apiKey}`, {
    idToken: created.idToken ?? '', displayName: displayName.trim(), returnSecureToken: true,
  });
  const user = await makeUser(named, displayName.trim());
  await saveUser(user);
  return user;
}

export async function loginWithEmail(email: string, password: string) {
  const data = await requestFirebase(`${IDENTITY_API}:signInWithPassword?key=${encodeURIComponent(getApiKey())}`, {
    email: email.trim(), password, returnSecureToken: true,
  });
  const user = await makeUser(data);
  await saveUser(user);
  return user;
}

export async function sendPasswordReset(email: string) {
  await requestFirebase(`${IDENTITY_API}:sendOobCode?key=${encodeURIComponent(getApiKey())}`, {
    requestType: 'PASSWORD_RESET', email: email.trim(),
  });
}

export async function logoutFirebaseUser() {
  authGeneration += 1;
  await AsyncStorage.removeItem(SESSION_KEY);
  publish(null);
}

export function getFirebaseAuthError(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : '';
  const messages: Record<string, string> = {
    'auth/email-already-in-use': 'Email này đã được đăng ký.',
    'auth/invalid-email': 'Địa chỉ email chưa hợp lệ.',
    'auth/invalid-credential': 'Email hoặc mật khẩu không chính xác.',
    'auth/weak-password': 'Mật khẩu cần có ít nhất 6 ký tự.',
    'auth/too-many-requests': 'Bạn thử quá nhiều lần. Hãy chờ một chút rồi thử lại.',
    'auth/network-request-failed': 'Không thể kết nối Firebase. Hãy kiểm tra mạng.',
    'auth/operation-not-allowed': 'Email/mật khẩu chưa được bật trong Firebase Authentication.',
    'auth/configuration-not-found': 'Firebase Authentication chưa được khởi tạo cho project. Hãy mở Authentication trong Firebase Console và chọn Get started.',
    'auth/invalid-request': 'Firebase từ chối dữ liệu đăng ký. Hãy kiểm tra email, mật khẩu và thử lại.',
    'auth/user-disabled': 'Tài khoản này đã bị vô hiệu hóa.',
    'auth/invalid-api-key': 'Firebase API key không hợp lệ. Hãy kiểm tra cấu hình trong tệp .env.',
  };

  if (error instanceof Error && error.message.startsWith('Thiếu cấu hình Firebase.')) return error.message;
  if (error instanceof Error && error.message.startsWith('Firebase không trả về')) return error.message;
  return messages[code] ?? 'Không thể xác thực lúc này. Vui lòng thử lại.';
}

export const firebaseAuthProvider: AuthProvider = {
  observeUser: observeFirebaseUser,
  register: registerWithEmail,
  login: loginWithEmail,
  requestPasswordReset: sendPasswordReset,
  logout: logoutFirebaseUser,
  getErrorMessage: getFirebaseAuthError,
};
