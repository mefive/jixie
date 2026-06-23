import { computed, makeObservable } from 'mobx';
import { LoaderModel } from '@src/lib';
import { fetchMe, logout as apiLogout, type AuthUser } from '@src/api/client';

// Global auth-state singleton (not a complex). Single source of truth = loader.result.user; user/authenticated are both derived.
// Stores no token, never touches localStorage —— relies entirely on the httpOnly session cookie.
class AuthStore {
  public loader = new LoaderModel<{ user: AuthUser | null }>();

  public constructor() {
    makeObservable(this, { user: computed, authenticated: computed });
    this.loader.setup({ request: () => fetchMe() });
  }

  // Called once at startup to push the /me result into the loader
  public async load(): Promise<void> {
    await this.loader.run().catch(() => {});
  }

  public get user(): AuthUser | null {
    return this.loader.result?.user ?? null;
  }

  public get authenticated(): boolean {
    return !!this.user;
  }

  // Called by login-store after a successful login to push the already-obtained user into the loader, saving a /me call
  public async setUser(user: AuthUser): Promise<void> {
    await this.loader.run(Promise.resolve({ user }));
  }

  public async logout(): Promise<void> {
    await apiLogout().catch(() => {});
    await this.loader.run(Promise.resolve({ user: null }));
  }
}

export const authStore = new AuthStore();
