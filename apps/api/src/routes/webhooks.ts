import { handleArcStreamsWebhook, type ArcStreamsSignal } from "@hedged/arc/server";
import { handleStreamsWebhook, type StreamsSignal } from "@hedged/solana/server";
import type { FastifyInstance } from "fastify";

/** Raw request as QuickNode sent it: the HMAC is over these exact bytes. */
export interface RawWebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: Buffer;
}

/**
 * Where QuickNode Streams deliveries go. One route serves whichever chain the backend runs on;
 * the handler checks X-QN-Signature over the raw body, rejects stale timestamps, gunzips if needed
 * and hands the transactions to the gateway, which re-verifies them on-chain before any handler.
 */
export interface StreamsWebhookDeps {
  handle(req: RawWebhookRequest): { status: number; body: unknown };
}

/** Solana: Dev 3's `handleStreamsWebhook` (packages/solana). */
export function solanaStreamsHandler(
  securityToken: string,
  ingest: (signals: StreamsSignal[]) => void,
): StreamsWebhookDeps {
  return { handle: (req) => handleStreamsWebhook(req, { securityToken, onSignals: ingest }) };
}

/** Arc: `handleArcStreamsWebhook` (packages/arc), limited to our escrow's logs. */
export function arcStreamsHandler(
  securityToken: string,
  escrow: string,
  ingest: (signals: ArcStreamsSignal[]) => void,
): StreamsWebhookDeps {
  return {
    handle: (req) => handleArcStreamsWebhook(req, { securityToken, escrow, onSignals: ingest }),
  };
}

/**
 * POST /webhooks/quicknode. Runs in its own plugin scope with a raw-buffer body parser, because
 * the signature must be checked over the bytes before any JSON parsing; other routes keep JSON.
 */
export async function registerStreamsWebhook(
  app: FastifyInstance,
  deps: StreamsWebhookDeps | null,
): Promise<void> {
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser(
      "*",
      { parseAs: "buffer", bodyLimit: 5 * 1024 * 1024 },
      (_req, body, done) => done(null, body),
    );
    scope.post("/webhooks/quicknode", async (req, reply) => {
      if (!deps) return reply.code(503).send({ ok: false, error: "streams_disabled" });
      const result = deps.handle({
        headers: req.headers,
        rawBody: (req.body as Buffer | undefined) ?? Buffer.alloc(0),
      });
      return reply.code(result.status).send(result.body);
    });
  });
}
