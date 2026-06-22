import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { BaseStore, LoaderModel } from '@src/lib';
import { ApiError, requestEmailLogin, verifyEmailLogin, type AuthUser } from '@src/api/client';
import { authStore } from '@src/store';

export type LoginStep = 'email' | 'invite' | 'verify';

type LoginSetupParams = {};

// 登录三步状态机：email →(新邮箱)invite → verify。
// step 由 (challengeId, needsInvite) 派生，不单独存。
export class LoginStore extends BaseStore<LoginSetupParams> {
  public email = '';
  public inviteCode = '';
  public code = '';

  public challengeId: string | null = null;
  public needsInvite = false;
  public errorMessage: string | null = null;

  public requestLoader = new LoaderModel<{ challengeId: string; expiresIn: number }>();
  public verifyLoader = new LoaderModel<{ user: AuthUser }>();

  public constructor(parentStore?: any) {
    super(parentStore);
    makeObservable(this, {
      email: observable.ref,
      inviteCode: observable.ref,
      code: observable.ref,
      challengeId: observable.ref,
      needsInvite: observable.ref,
      errorMessage: observable.ref,
      step: computed,
      setEmail: action,
      setInviteCode: action,
      setCode: action,
      back: action,
    });
  }

  public setup(params: LoginSetupParams) {
    super.setup(params);
    // 两个 loader 的 request 闭包读当前 state：needsInvite 决定是否带邀请码
    this.requestLoader.setup({
      request: () =>
        requestEmailLogin({
          email: this.email.trim(),
          inviteCode: this.needsInvite ? this.inviteCode.trim() : undefined,
        }),
    });
    this.verifyLoader.setup({
      request: () => verifyEmailLogin({ challengeId: this.challengeId!, code: this.code.trim() }),
    });
    this.registCleaner(() => this.requestLoader.cleanup());
    this.registCleaner(() => this.verifyLoader.cleanup());
  }

  public get step(): LoginStep {
    if (this.challengeId) return 'verify';
    if (this.needsInvite) return 'invite';
    return 'email';
  }

  public setEmail(v: string) {
    runInAction(() => {
      this.email = v;
      this.errorMessage = null;
    });
  }

  public setInviteCode(v: string) {
    runInAction(() => {
      this.inviteCode = v;
      this.errorMessage = null;
    });
  }

  public setCode(v: string) {
    runInAction(() => {
      this.code = v;
      this.errorMessage = null;
    });
  }

  // 第一步：只发邮箱探测。新用户后端会以 field=inviteCode 报错 → 切到 invite 步
  public async submitEmail() {
    try {
      const res = await this.requestLoader.run();
      runInAction(() => {
        this.challengeId = res.challengeId;
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VALIDATION_FAILED' && e.field === 'inviteCode') {
        runInAction(() => {
          this.needsInvite = true;
        });
      } else {
        this.setError(e);
      }
    }
  }

  // 第二步（仅新用户）：带邀请码再发一次 → 拿 challengeId
  public async submitInvite() {
    try {
      const res = await this.requestLoader.run();
      runInAction(() => {
        this.challengeId = res.challengeId;
      });
    } catch (e) {
      this.setError(e);
    }
  }

  // 第三步：验码。成功把 user 灌进全局 authStore，路由守卫随即放行
  public async submitCode() {
    try {
      const res = await this.verifyLoader.run();
      await authStore.setUser(res.user);
    } catch (e) {
      this.setError(e);
    }
  }

  public back() {
    runInAction(() => {
      this.challengeId = null;
      this.needsInvite = false;
      this.code = '';
      this.errorMessage = null;
    });
  }

  private setError(e: unknown) {
    runInAction(() => {
      this.errorMessage = e instanceof Error ? e.message : '请求失败';
    });
  }
}
