import { createAuthService, type AuthProvider, type AuthUser } from '../auth-provider';

const testUser: AuthUser = {
  uid: 'learner-1',
  email: 'learner@example.com',
  displayName: 'Learner',
};

function makeProvider(): AuthProvider {
  return {
    observeUser: jest.fn((onChange) => {
      onChange(testUser);
      return jest.fn();
    }),
    register: jest.fn(async () => testUser),
    login: jest.fn(async () => testUser),
    requestPasswordReset: jest.fn(async () => undefined),
    logout: jest.fn(async () => undefined),
    getErrorMessage: jest.fn(() => 'Authentication failed.'),
  };
}

describe('provider-neutral auth service', () => {
  test('delegates login and registration to the configured provider', async () => {
    const provider = makeProvider();
    const auth = createAuthService(provider);

    await expect(auth.login('learner@example.com', 'secret1')).resolves.toEqual(testUser);
    await expect(auth.register('learner@example.com', 'secret1', 'Learner')).resolves.toEqual(testUser);
    expect(provider.login).toHaveBeenCalledWith('learner@example.com', 'secret1');
    expect(provider.register).toHaveBeenCalledWith('learner@example.com', 'secret1', 'Learner');
  });

  test('delegates session, password reset, logout, and provider errors', async () => {
    const provider = makeProvider();
    const auth = createAuthService(provider);
    const onChange = jest.fn();

    auth.observeUser(onChange);
    await auth.requestPasswordReset('learner@example.com');
    await auth.logout();

    expect(onChange).toHaveBeenCalledWith(testUser);
    expect(provider.requestPasswordReset).toHaveBeenCalledWith('learner@example.com');
    expect(provider.logout).toHaveBeenCalledTimes(1);
    expect(auth.getErrorMessage(new Error('unknown'))).toBe('Authentication failed.');
  });
});
