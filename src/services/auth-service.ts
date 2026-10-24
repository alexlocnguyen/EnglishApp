import { bffAuthProvider } from './bff-auth';
import { createAuthService } from './auth-provider';

// UI code depends on this provider-neutral contract, so another auth backend can replace Firebase.
export const authService = createAuthService(bffAuthProvider);
