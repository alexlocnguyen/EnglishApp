export type AuthUser = {
  uid: string;
  email: string;
  displayName: string;
};

export interface AuthProvider {
  observeUser(onChange: (user: AuthUser | null) => void): () => void;
  register(email: string, password: string, displayName: string): Promise<AuthUser>;
  login(email: string, password: string): Promise<AuthUser>;
  requestPasswordReset(email: string): Promise<void>;
  logout(): Promise<void>;
  getErrorMessage(error: unknown): string;
}

export function createAuthService(provider: AuthProvider): AuthProvider {
  return {
    observeUser: (onChange) => provider.observeUser(onChange),
    register: (email, password, displayName) => provider.register(email, password, displayName),
    login: (email, password) => provider.login(email, password),
    requestPasswordReset: (email) => provider.requestPasswordReset(email),
    logout: () => provider.logout(),
    getErrorMessage: (error) => provider.getErrorMessage(error),
  };
}
