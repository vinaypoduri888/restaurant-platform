import { db } from "@repo/database";

export interface ReadinessResult {
  ready: boolean;
  checks: { database: "ok" | "unavailable" };
}

export const healthService = {
  /**
   * Liveness: the process is running and able to answer. Deliberately checks
   * no dependencies — a failing database should not cause an orchestrator to
   * kill an otherwise healthy process.
   */
  isAlive(): boolean {
    return true;
  },

  /**
   * Readiness: this instance can actually serve traffic, which means the
   * database must be reachable. A load balancer should stop routing here
   * when this fails.
   */
  async checkReadiness(): Promise<ReadinessResult> {
    try {
      await db.$queryRaw`SELECT 1`;
      return { ready: true, checks: { database: "ok" } };
    } catch {
      // The underlying reason is logged by the caller; it is never returned to
      // the client, since connection errors can contain host and credential hints.
      return { ready: false, checks: { database: "unavailable" } };
    }
  },
};
