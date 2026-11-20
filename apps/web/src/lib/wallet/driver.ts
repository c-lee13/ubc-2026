import type { EmailLoginDto } from "../api";

/**
 * What the app needs from a wallet UI. Circle's W3SSdk is the real one (circle.ts); a dev-only
 * fixture (fixture.ts) stands in when there is no Circle App ID. Pages never touch either directly.
 */
export interface WalletDriver {
  kind: "circle" | "fixture";
  /** Stable per browser (Circle: sdk.getDeviceId()). */
  getDeviceId(): Promise<string>;
  /**
   * Shows the email-code screen; resolves with the session once the code is accepted, rejects if
   * the screen is closed first. `resend` starts a fresh login (new code) for the screen's Resend.
   */
  verifyEmail(
    login: EmailLoginDto,
    email: string,
    resend?: () => Promise<EmailLoginDto>,
  ): Promise<CircleSession>;
  setAuthentication(session: CircleSession): void;
  /**
   * Shows the approval screen for a challenge; resolves once approved, rejects otherwise. A
   * typed-data challenge (one-tap checkout) resolves with the signature.
   */
  execute(challengeId: string, what: string): Promise<ChallengeOutcome>;
}

/** What an approved challenge gave back: a signature for sign challenges, nothing otherwise. */
export interface ChallengeOutcome {
  signature?: string;
}

export interface CircleSession {
  userToken: string;
  encryptionKey: string;
}

/** A wallet problem in words the person at the keyboard can act on. */
export class WalletUserError extends Error {
  constructor(
    readonly title: string,
    readonly detail: string,
  ) {
    super(`${title}. ${detail}`);
    this.name = "WalletUserError";
  }
}
