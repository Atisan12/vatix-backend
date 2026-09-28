import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';

/**
 * Stable error codes for seed marker operations.
 * These are surfaced to callers so untrusted clients cannot infer internal
 * state from raw Prisma errors, and so ops can alert on a fixed vocabulary.
 */
export const SEED_MARKER_ERRORS = {
  INVALID_INPUT: 'SEED_MARKER_INVALID_INPUT',
  UNAUTHORIZED: 'SEED_MARKER_UNAUTHORIZED',
  DEPENDENCY_UNAVAILABLE: 'SEED_MARKER_DEPENDENCY_UNAVAILABLE',
  CONFLICT: 'SEED_MARKER_CONFLICT',
  INTERNAL: 'SEED_MARKER_INTERNAL',
} as const;

export type SeedMarkerErrorCode =
  (typeof SEED_MARKER_ERRORS)[keyof typeof SEED_MARKER_ERRORS];

export class SeedMarkerError extends Error {
  readonly code: SeedMarkerErrorCode;
  readonly correlationId: string;

  constructor(code: SeedMarkerErrorCode, message: string, correlationId: string) {
    super(message);
    this.name = 'SeedMarkerError';
    this.code = code;
    this.correlationId = correlationId;
  }
}

/**
 * Seed markers record the deterministic seed state used by the indexer so that
 * replays and concurrent writers converge on the same marker. The marker name
 * is the idempotency key; the value is the last committed seed payload.
 */
export interface SeedMarkerInput {
  name: string;
  value: string;
  /** Optional caller-supplied idempotency key; defaults to `name`. */
  idempotencyKey?: string;
}

export interface SeedMarkerRecord {
  name: string;
  value: string;
  idempotencyKey: string;
  updatedAt: Date;
}

/**
 * Authorization context. Seed markers are a privileged surface: writes are
 * deny-by-default and require an explicit admin role. Untrusted clients cannot
 * bypass this because the check happens before any DB access.
 */
export interface SeedMarkerAuthContext {
  role?: string | null;
  actorId?: string | null;
}

const ADMIN_ROLE = 'admin';
const MAX_NAME_LENGTH = 128;
const MAX_VALUE_LENGTH = 4096;

function newCorrelationId(): string {
  return randomUUID();
}

function assertAuthorized(
  auth: SeedMarkerAuthContext | undefined,
  correlationId: string,
): void {
  if (!auth || auth.role !== ADMIN_ROLE || !auth.actorId) {
    throw new SeedMarkerError(
      SEED_MARKER_ERRORS.UNAUTHORIZED,
      'seed marker writes require an authenticated admin role',
      correlationId,
    );
  }
}

function assertValidInput(
  input: SeedMarkerInput,
  correlationId: string,
): void {
  if (
    !input ||
    typeof input.name !== 'string' ||
    input.name.length === 0 ||
    input.name.length > MAX_NAME_LENGTH ||
    typeof input.value !== 'string' ||
    input.value.length > MAX_VALUE_LENGTH
  ) {
    throw new SeedMarkerError(
      SEED_MARKER_ERRORS.INVALID_INPUT,
      'seed marker name/value failed validation',
      correlationId,
    );
  }
}

/**
 * Classify a Prisma failure so callers fail closed on dependency outages
 * (DB/connection) rather than silently succeeding.
 */
function classifyPrismaError(
  err: unknown,
  correlationId: string,
): SeedMarkerError {
  if (err instanceof SeedMarkerError) {
    return err;
  }
  if (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError ||
    err instanceof Prisma.PrismaClientUnknownRequestError
  ) {
    return new SeedMarkerError(
      SEED_MARKER_ERRORS.DEPENDENCY_UNAVAILABLE,
      'seed marker store is unavailable',
      correlationId,
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return new SeedMarkerError(
        SEED_MARKER_ERRORS.CONFLICT,
        'seed marker conflict',
        correlationId,
      );
    }
    if (err.code === 'P1001' || err.code === 'P1002' || err.code === 'P1017') {
      return new SeedMarkerError(
        SEED_MARKER_ERRORS.DEPENDENCY_UNAVAILABLE,
        'seed marker store is unavailable',
        correlationId,
      );
    }
  }
  return new SeedMarkerError(
    SEED_MARKER_ERRORS.INTERNAL,
    'seed marker operation failed',
    correlationId,
  );
}

/**
 * Storage facade for seed markers. Writes are idempotent on the marker name:
 * concurrent or replayed requests converge on a single row via upsert, so a
 * retried request cannot create duplicate markers or double-apply a seed.
 */
export class SeedMarkerStorage {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  /**
   * Read a seed marker. Reads are allowed for any authenticated caller; the
   * marker name is the lookup key.
   */
  async getMarker(
    name: string,
    auth?: SeedMarkerAuthContext,
  ): Promise<SeedMarkerRecord | null> {
    const correlationId = newCorrelationId();
    if (!auth || !auth.actorId) {
      throw new SeedMarkerError(
        SEED_MARKER_ERRORS.UNAUTHORIZED,
        'seed marker reads require an authenticated caller',
        correlationId,
      );
    }
    if (typeof name !== 'string' || name.length === 0 || name.length > MAX_NAME_LENGTH) {
      throw new SeedMarkerError(
        SEED_MARKER_ERRORS.INVALID_INPUT,
        'seed marker name failed validation',
        correlationId,
      );
    }
    try {
      const row = await this.prisma.seedMarker.findUnique({ where: { name } });
      if (!row) {
        return null;
      }
      return {
        name: row.name,
        value: row.value,
        idempotencyKey: row.idempotencyKey,
        updatedAt: row.updatedAt,
      };
    } catch (err) {
      throw classifyPrismaError(err, correlationId);
    }
  }

  /**
   * Idempotently write a seed marker. Requires admin authz (deny-by-default).
   * Uses upsert keyed on `name` so concurrent/replayed requests are safe and
   * fail closed if the DB is unavailable.
   */
  async putMarker(
    input: SeedMarkerInput,
    auth?: SeedMarkerAuthContext,
  ): Promise<SeedMarkerRecord> {
    const correlationId = newCorrelationId();
    assertAuthorized(auth, correlationId);
    assertValidInput(input, correlationId);

    const idempotencyKey = input.idempotencyKey ?? input.name;

    try {
      const row = await this.prisma.seedMarker.upsert({
        where: { name: input.name },
        create: {
          name: input.name,
          value: input.value,
          idempotencyKey,
        },
        update: {
          value: input.value,
          idempotencyKey,
        },
      });
      return {
        name: row.name,
        value: row.value,
        idempotencyKey: row.idempotencyKey,
        updatedAt: row.updatedAt,
      };
    } catch (err) {
      throw classifyPrismaError(err, correlationId);
    }
  }
}
