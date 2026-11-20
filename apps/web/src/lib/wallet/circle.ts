import type {
  ChallengeCompleteCallback,
  LoginCompleteCallback,
  LoginConfigs,
} from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import type { EmailLoginDto } from "../api";
import { OTP_HINT } from "./otp-hint";
import {
  WalletUserError,
  type ChallengeOutcome,
  type CircleSession,
  type WalletDriver,
} from "./driver";

/**
 * Circle user-controlled wallets, email login (docs/email-wallets.md), on the official web SDK.
 * Browser only: the SDK builds its iframe in the constructor, so it is imported on first use.
 *
 * Login:  getDeviceId -> (POST /api/wallet/email-login) -> updateConfigs + verifyOtp -> callback
 *         gives { userToken, encryptionKey } -> setAuthentication.
 * Code screen (Circle-hosted, pw-auth.circle.com, SDK 1.1.11): it prints the code's 3-letter prefix
 *         ("ABC -") itself and takes only the 6 digits in six boxes. Paste works only with digits
 *         alone, so iOS "From Mail" autofill of "ABC-123456" is rejected. We control only its
 *         words, colors and the Resend button; the boxes and the email format are Circle's.
 * Money:  every challengeId from our API is approved here with sdk.execute. A typed-data
 *         challenge (one-tap checkout) resolves with its signature for POST .../submit.
 */
export async function createCircleDriver(appId: string): Promise<WalletDriver> {
  const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
  let pending: {
    resolve: (s: CircleSession) => void;
    reject: (e: Error) => void;
    email: string;
    resend?: () => Promise<EmailLoginDto>;
    /** Why the last try failed, shown if the screen is then closed. */
    lastProblem?: WalletUserError;
  } | null = null;

  const onLogin: LoginCompleteCallback = (error, result) => {
    const p = pending;
    if (!p) return;
    if (error || !result) {
      // A wrong code: Circle keeps its screen open so the person can fix it, and a later right
      // code still succeeds. Wait for that, or for the screen to close (watchClose below).
      p.lastProblem = new WalletUserError(
        "Code not accepted",
        error?.message
          ? `Circle said: ${error.message}. Try again for a new code.`
          : "The email code didn't go through. Try again for a new code.",
      );
      return;
    }
    pending = null;
    p.resolve({ userToken: result.userToken, encryptionKey: result.encryptionKey });
  };

  // Closing the code screen (its X, or an expired code) only removes the SDK's iframe; no callback
  // fires. Watch for that so the login card doesn't wait forever.
  const watchClose = () => {
    const obs = new MutationObserver(() => {
      if (document.getElementById("sdkIframe")) return;
      obs.disconnect();
      const p = pending;
      pending = null;
      p?.reject(
        p.lastProblem ??
          new WalletUserError(
            "Login not finished",
            "You closed the code screen. Try again for a new code.",
          ),
      );
    });
    obs.observe(document.body, { childList: true });
  };

  const openCodeScreen = (login: EmailLoginDto, email: string) => {
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
  };

  const sdk = new W3SSdk({ appSettings: { appId } }, onLogin);
  // The code screen's "Resend" only tells us it was tapped: we start a fresh login (Circle emails a
  // new code, the old one stops working) and reopen the screen with it.
  sdk.setOnResendOtpEmail(() => {
    const p = pending;
    if (!p?.resend) return;
    p.resend().then(
      (next) => {
        if (pending !== p) return;
        p.lastProblem = undefined;
        openCodeScreen(next, p.email);
      },
      () => {
        p.lastProblem = new WalletUserError(
          "New code not sent",
          "We couldn't send a new code. Wait a minute, then try again.",
        );
      },
    );
  });
  // Circle's approval screens in the app's colors and words. The signed data itself is Circle's to
  // show (it is the user's proof of what they approve), so only the frame and labels change.
  sdk.setThemeColor({
    backdrop: "#000000",
    backdropOpacity: 0.7,
    bg: "#15101d",
    divider: "#2d2439",
    textMain: "#f5f0fa",
    textAuxiliary: "#a99db9",
    textSummary: "#f5f0fa",
    textSummaryHighlight: "#ff4fb0",
    textPlaceholder: "#6f6481",
    // The code boxes: empty ones are drawn as rings, the next one to fill in pink, typed digits in
    // the main text color (Circle's defaults are a dark grey that vanishes on this background).
    pinDotBase: "#2a2236",
    pinDotBaseBorder: "#a99db9",
    pinDotActivated: "#ff4fb0",
    enteredPinText: "#f5f0fa",
    inputText: "#f5f0fa",
    inputBg: "#1f1829",
    inputBorderFocused: "#a98bff",
    inputBorderFocusedError: "#ff4d4f",
    plainBtnText: "#a98bff",
    textDetailToggle: "#a98bff",
    textInteractive: "#0b0710",
    interactiveBg: "#f5f0fa",
    success: "#ff4fb0",
    error: "#ff4d4f",
  });
  sdk.setLocalizations({
    signatureRequest: {
      title: "Approve payment",
      subtitle: "One approval pays for your order. Wincentive covers the network fee.",
      descriptionLabel: "Payment details",
    },
    contractInteraction: { title: "Approve" },
    emailOtp: {
      title: "Enter your code",
      subtitle: OTP_HINT,
      resendHint: "No email?",
      resend: "Send a new code",
    },
  });

  return {
    kind: "circle",
    getDeviceId: () => sdk.getDeviceId(),

    verifyEmail(login: EmailLoginDto, email: string, resend?: () => Promise<EmailLoginDto>) {
      return new Promise<CircleSession>((resolve, reject) => {
        pending?.reject(new WalletUserError("Login restarted", "A newer login took over."));
        pending = { resolve, reject, email, resend };
        openCodeScreen(login, email);
        watchClose();
      });
    },

    // Only the two fields Circle needs (the stored session also carries the email).
    setAuthentication: (s) =>
      sdk.setAuthentication({ userToken: s.userToken, encryptionKey: s.encryptionKey }),

    execute(challengeId: string) {
      return new Promise<ChallengeOutcome>((resolve, reject) => {
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
          // Sign challenges (one-tap checkout) carry the signature in result.data.signature.
          const data = (result as { data?: { signature?: unknown } } | undefined)?.data;
          resolve(typeof data?.signature === "string" ? { signature: data.signature } : {});
        };
        sdk.execute(challengeId, done);
      });
    },
  };
}
