import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { BaseStore, LoaderModel } from '@src/lib';
import { ApiError, requestEmailLogin, verifyEmailLogin, type AuthUser } from '@src/api/client';
import { authStore } from '@src/store';

export type LoginStep = 'email' | 'invite' | 'verify';

type LoginSetupParams = {};

// Three-step login state machine: email →(new email)invite → verify.
// step is derived from (challengeId, needsInvite), not stored separately.
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
    // Both loaders' request closures read current state: needsInvite decides whether to send the invite code
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
    if (this.challengeId) {
      return 'verify';
    }
    if (this.needsInvite) {
      return 'invite';
    }
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

  // Step 1: probe with email only. For a new user the backend errors with field=inviteCode → switch to the invite step
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

  // Step 2 (new users only): resend with the invite code → get challengeId
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

  // Step 3: verify the code. On success push user into the global authStore, and the route guard lets it through
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
