import { randomUUID } from "node:crypto";
import { withTransaction } from "../db";
import { ConflictError, NotFoundError } from "../utils/errors";
import { writeOAuthAudit } from "./oauth.repository";
import {
  countAdmins,
  findUserById,
  setUserRole,
} from "./platform.repository";
import type { UserRecord, UserRole } from "./platform.entity";

/** pg_advisory_xact_lock key for Human admin role mutations ('CNAD'). */
const ADMIN_ROLE_ADVISORY_LOCK = 0x434e4144;

export type AdminActor =
  | { type: "service"; request_id: string }
  | { type: "user"; user_id: string; request_id: string };

function requestIdFrom(request: Request): string {
  return request.headers.get("X-CNothing-Request-Id")?.trim() || randomUUID();
}

export function readAdminRequestId(request: Request): string {
  return requestIdFrom(request);
}

async function mutateRole(input: {
  userId: string;
  role: UserRole;
  actor: AdminActor;
  action: "admin.bootstrap" | "admin.promote" | "admin.demote";
}): Promise<UserRecord> {
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [ADMIN_ROLE_ADVISORY_LOCK]);

    const target = await findUserById(input.userId, client);
    if (!target) {
      throw new NotFoundError("User not found");
    }

    if (input.action === "admin.bootstrap") {
      const adminCount = await countAdmins(client);
      if (adminCount > 0) {
        throw new ConflictError("Bootstrap disabled: an admin already exists", {
          error_code: "bootstrap_disabled",
        });
      }
    }

    if (input.action === "admin.demote" && target.role === "admin") {
      const adminCount = await countAdmins(client);
      if (adminCount <= 1) {
        throw new ConflictError("Cannot remove the last admin", {
          error_code: "last_admin",
        });
      }
    }

    if (target.role === input.role) {
      await writeOAuthAudit(
        {
          user_id: input.actor.type === "user" ? input.actor.user_id : target.id,
          action: input.action,
          metadata: {
            actor: input.actor,
            target: target.id,
            role: input.role,
            unchanged: true,
            source: "admin",
          },
        },
        client,
      );
      return target;
    }

    const updated = await setUserRole({ id: target.id, role: input.role }, client);
    await writeOAuthAudit(
      {
        user_id: input.actor.type === "user" ? input.actor.user_id : updated.id,
        action: input.action,
        metadata: {
          actor: input.actor,
          target: updated.id,
          role: updated.role,
          source: "admin",
        },
      },
      client,
    );
    return updated;
  });
}

export async function bootstrapFirstAdmin(input: {
  userId: string;
  requestId: string;
}): Promise<UserRecord> {
  return mutateRole({
    userId: input.userId,
    role: "admin",
    action: "admin.bootstrap",
    actor: { type: "service", request_id: input.requestId },
  });
}

export async function promoteUser(input: {
  userId: string;
  actorUserId: string;
  requestId: string;
}): Promise<UserRecord> {
  return mutateRole({
    userId: input.userId,
    role: "admin",
    action: "admin.promote",
    actor: { type: "user", user_id: input.actorUserId, request_id: input.requestId },
  });
}

export async function demoteUser(input: {
  userId: string;
  actorUserId: string;
  requestId: string;
}): Promise<UserRecord> {
  return mutateRole({
    userId: input.userId,
    role: "user",
    action: "admin.demote",
    actor: { type: "user", user_id: input.actorUserId, request_id: input.requestId },
  });
}
