import AsyncStorage from '@react-native-async-storage/async-storage';
import { loginWithEmail, logoutFirebaseUser, registerWithEmail, sendPasswordReset } from '../firebase-auth';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Firebase auth flows', () => {
  const fetchMock: jest.MockedFunction<typeof fetch> = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY = 'test-public-key';
    globalThis.fetch = fetchMock;
  });

  test('logs in, stores the session, and tolerates an unavailable profile lookup', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        localId: 'user-1',
        idToken: 'id-token',
        refreshToken: 'refresh-token',
        email: 'learner@example.com',
      }))
      .mockRejectedValueOnce(new Error('offline'));

    await expect(loginWithEmail('learner@example.com', 'secret1')).resolves.toMatchObject({
      uid: 'user-1',
      email: 'learner@example.com',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'elevate.firebase.session',
      expect.stringContaining('id-token'),
    );
  });

  test('registers an account through Firebase and persists its session', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        localId: 'new-user',
        idToken: 'sign-up-token',
        refreshToken: 'refresh-token',
        email: 'new@example.com',
      }))
      .mockResolvedValueOnce(jsonResponse({
        localId: 'new-user',
        idToken: 'named-token',
        refreshToken: 'refresh-token',
        email: 'new@example.com',
        displayName: 'New learner',
      }))
      .mockRejectedValueOnce(new Error('profile lookup offline'));

    await expect(registerWithEmail('new@example.com', 'secret1', 'New learner')).resolves.toMatchObject({
      uid: 'new-user',
      displayName: 'New learner',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'elevate.firebase.session',
      expect.stringContaining('new-user'),
    );
  });

  test('sends password reset and clears the local session on logout', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await sendPasswordReset('learner@example.com');
    await logoutFirebaseUser();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('sendOobCode'),
      expect.objectContaining({ body: expect.stringContaining('PASSWORD_RESET') }),
    );
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('elevate.firebase.session');
  });
});
