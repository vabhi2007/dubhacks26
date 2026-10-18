// Owner: A. Platform API for other workstreams (B's tools/Watcher import from here).
export { purchase, resolveApproval, type PurchaseInput, type PurchaseResult } from "./purchase";
export { pickCard, rewardFor } from "./cards";
export { requestApproval, listApprovals, type ApprovalRequest, type ApprovalView } from "./approvals";
export { authorize, listMandates } from "./mandates";
export { emit, recentEvents } from "./events";
export { subscribe } from "./sse";
