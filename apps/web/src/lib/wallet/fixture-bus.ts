/**
 * DEV-ONLY fixture plumbing: how the fixture driver asks the page to show its stand-in screens
 * (email code, approval). Holds no data. Used only when publicConfig.walletFixture is on.
 */
export type FixtureSheet =
  | {
      kind: "otp";
      email: string;
      resolve: (code: string) => void;
      reject: () => void;
    }
  | {
      kind: "approve";
      what: string;
      resolve: () => void;
      reject: () => void;
    };

let listener: ((s: FixtureSheet | null) => void) | null = null;

export function onFixtureSheet(l: (s: FixtureSheet | null) => void): () => void {
  listener = l;
  return () => {
    if (listener === l) listener = null;
  };
}

export function showFixtureSheet(s: FixtureSheet | null): void {
  listener?.(s);
}
