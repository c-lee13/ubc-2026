import type {
  ChallengeCompleteCallback,
  LoginCompleteCallback,
  LoginConfigs,
} from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import type { EmailLoginDto } from "../api";
import { WalletUserError, type CircleSession, type WalletDriver } from "./driver";

/**
 * Circle user-controlled wallets, email login (docs/email-wallets.md), on the official web SDK.
 * Browser only: the SDK builds its iframe in the constructor, so it is imported on first use.
 *
 * Login:  getDeviceId -> (POST /api/wallet/email-login) -> updateConfigs + verifyOtp -> callback
 *         gives { userToken, encryptionKey } -> setAuthentication.
 * Money:  every challengeId from our API is approved here with sdk.execute.
 */
export async function createCircleDriver(appId: string): Promise<WalletDriver> {
  const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
  let pending: { resolve: (s: CircleSession) => void; reject: (e: Error) => void } | null = null;

  const onLogin: LoginCompleteCallback = (error, result) => {
    const p = pending;
    pending = null;
    if (!p) return;
    if (error || !result) {
      p.reject(
        new WalletUserError(
          "Code not accepted",
          error?.message
            ? `Circle said: ${error.message}`
            : "The email code didn't go through. Request a new one.",
        ),
      );
      return;
    }
    p.resolve({ userToken: result.userToken, encryptionKey: result.encryptionKey });
  };

  const sdk = new W3SSdk({ appSettings: { appId } }, onLogin);

  return {
    kind: "circle",
    getDeviceId: () => sdk.getDeviceId(),

    verifyEmail(login: EmailLoginDto, email: string) {
      return new Promise<CircleSession>((resolve, reject) => {
        pending = { resolve, reject };
        // Spec: loginConfigs carries { deviceToken, deviceEncryptionKey, otpToken, email: { email } }.
        // SDK 1.1.11 types have no `email` field (the otpToken is already bound to the address), so
        // the extra field is passed through untyped exactly as the spec asks.
        const loginConfigs = {
          deviceToken: login.deviceToken,
          deviceEncryptionKey: login.deviceEncryptionKey,
          otpToken: login.otpToken,
          email: { email },
        } as LoginConfigs;
        sdk.updateConfigs({ appSettings: { appId: login.appId }, loginConfigs }, onLogin);
        sdk.verifyOtp();
      });
    },

    setAuthentication: (s) => sdk.setAuthentication(s),

    execute(challengeId: string) {
      return new Promise<void>((resolve, reject) => {
        const done: ChallengeCompleteCallback = (error, result) => {
          if (error) {
            reject(
              /cancel|close|denied|reject/i.test(error.message)
                ? new WalletUserError(
                    "Not approved",
                    "You closed the approval, so nothing was sent.",
                  )
                : new WalletUserError("Approval failed", `Circle said: ${error.message}`),
            );
            return;
          }
          const status = result?.status;
          if (status === "FAILED" || status === "EXPIRED") {
            reject(
              new WalletUserError(
                status === "EXPIRED" ? "Approval expired" : "Approval failed",
                "Nothing was sent. Try again.",
              ),
            );
            return;
          }
          resolve();
        };
        sdk.execute(challengeId, done);
      });
    },
  };
}
