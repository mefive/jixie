import { computed, makeObservable } from 'mobx';
import { LoaderModel } from '@src/lib';
import { fetchMe, logout as apiLogout, type AuthUser } from '@src/api/client';

// 全局登录态单例（非 complex）。唯一真值 = loader.result.user，user/authenticated 都是派生。
// 不存 token、不碰 localStorage —— 全靠 httpOnly session cookie。
class AuthStore {
  public loader = new LoaderModel<{ user: AuthUser | null }>();

  public constructor() {
    makeObservable(this, { user: computed, authenticated: computed });
    this.loader.setup({ request: () => fetchMe() });
  }

  // 启动时调一次，把 /me 结果灌进 loader
  public async load(): Promise<void> {
    await this.loader.run().catch(() => {});
  }

  public get user(): AuthUser | null {
    return this.loader.result?.user ?? null;
  }

  public get authenticated(): boolean {
    return !!this.user;
  }

  // 登录成功后由 login-store 调用，把已拿到的 user 直接灌进 loader，省一次 /me
  public async setUser(user: AuthUser): Promise<void> {
    await this.loader.run(Promise.resolve({ user }));
  }

  public async logout(): Promise<void> {
    await apiLogout().catch(() => {});
    await this.loader.run(Promise.resolve({ user: null }));
  }
}

export const authStore = new AuthStore();
