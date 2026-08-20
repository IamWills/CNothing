import { ForbiddenError, NotFoundError, ValidationError } from "../utils/errors";
import {
  approvalFromAccessRow,
  approvalIsPending,
  type ApprovalRequest,
} from "./approval";
import {
  claimProxyAccessRequestUserHint,
  createProxyAccessRequest,
  decideProxyAccessRequest,
  findProxyAccessRequest,
  listPendingAccessRequestsForUser,
  type ProxyAccessRequestRecord,
} from "./proxy.repository";

/**
 * Single approval system. Delegation, and later action/transaction approvals,
 * all go through this service and the same iOS pairing / challenge path.
 */
export class ApprovalService {
  async createDelegation(input: {
    agent_id: string;
    provider_slug: string;
    requested_hosts: string[];
    reason?: string;
    user_hint?: string;
    callback_url?: string;
    ttl_seconds?: number;
    metadata?: Record<string, unknown>;
  }): Promise<ApprovalRequest> {
    const row = await createProxyAccessRequest(input);
    return approvalFromAccessRow(row);
  }

  async get(id: string): Promise<ApprovalRequest | null> {
    const row = await findProxyAccessRequest(id);
    return row ? approvalFromAccessRow(row) : null;
  }

  async listPendingForPrincipal(principalId: string): Promise<ApprovalRequest[]> {
    const rows = await listPendingAccessRequestsForUser(principalId);
    return rows.map(approvalFromAccessRow);
  }

  async claimForPrincipal(id: string, principalId: string): Promise<ApprovalRequest | null> {
    const row = await claimProxyAccessRequestUserHint({ id, user_hint: principalId });
    return row ? approvalFromAccessRow(row) : null;
  }

  /**
   * Load a still-pending approval the principal is allowed to decide.
   * Device challenges and web/iOS verdicts share this gate.
   */
  async requirePending(id: string, principalId?: string): Promise<ApprovalRequest> {
    const approval = await this.get(id);
    if (!approval) {
      throw new NotFoundError("Access request not found");
    }
    if (!approvalIsPending(approval)) {
      if (approval.status !== "pending") {
        throw new ValidationError(`Access request is already ${approval.status}`, {
          error_code: "access_request_not_pending",
        });
      }
      throw new ValidationError("Access request has expired", {
        error_code: "access_request_expired",
      });
    }
    if (
      principalId &&
      approval.principal.id &&
      approval.principal.id !== principalId
    ) {
      throw new ForbiddenError("Access request belongs to another principal", {
        error_code: "access_request_not_owned",
      });
    }
    return approval;
  }

  async deny(input: { id: string; principalId: string }): Promise<ProxyAccessRequestRecord> {
    await this.requirePending(input.id, input.principalId);
    const decided = await decideProxyAccessRequest({
      id: input.id,
      status: "denied",
      user_id: input.principalId,
    });
    if (!decided) {
      throw await this.noLongerPending(input.id);
    }
    return decided;
  }

  async noLongerPending(requestId: string): Promise<ValidationError> {
    const current = await this.get(requestId);
    const alreadyDecided = Boolean(current && current.status !== "pending");
    return new ValidationError(
      alreadyDecided ? `Access request is already ${current!.status}` : "Access request has expired",
      {
        error_code: alreadyDecided ? "access_request_not_pending" : "access_request_expired",
      },
    );
  }
}

export const approvalService = new ApprovalService();
