import type { LongTermWorkSchedulerStatus } from "./types";

export function workStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ready: "最近完整刷新成功", running: "正在读取本次任务", idle: "等待定时读取", disabled: "已停用",
    interrupted: "上次刷新中断", error: "上次刷新失败", partial: "本次来源尚未读全",
    uncertain: "模型结果待核对，未重复发送", budget_exhausted: "本轮预算已用完，可继续本次读取",
    analysis_failed: "本次提炼未通过，旧事项保留", blocked_permission: "等待飞书来源授权",
    blocked_configuration: "来源配置待检查", blocked_state: "读取记录待核对", blocked_maintenance: "服务维护中",
    pending: "等待开始", complete: "已完成", failed: "失败", commit_pending: "结果已返回，保存待核验",
  };
  return labels[status] || "状态待核对";
}

export function workIsActive(status: LongTermWorkSchedulerStatus) {
  return Boolean(status.active || status.requestPending || status.status === "running");
}

export function workSubmissionRejected(status: number, payload: unknown) {
  return status === 409 && typeof payload === "object" && payload !== null && "accepted" in payload && payload.accepted === false;
}

/** Only GETs are allowed here, including after a lost/timed-out POST response. */
export async function observeWorkRequest(options: {
  requestId: string;
  read: (requestId: string) => Promise<LongTermWorkSchedulerStatus>;
  onStatus: (status: LongTermWorkSchedulerStatus) => void;
  delay: (milliseconds: number) => Promise<void>;
  cancelled: () => boolean;
  now?: () => number;
  maxMilliseconds?: number;
}) {
  const now = options.now || Date.now;
  const deadline = now() + (options.maxMilliseconds ?? 330_000);
  while (!options.cancelled() && now() < deadline) {
    try {
      const status = await options.read(options.requestId);
      if (options.cancelled()) return null;
      options.onStatus(status);
      const requestedActive = status.requestedRun ? status.requestedRun.status === "running" : workIsActive(status);
      if (status.requestFound && !requestedActive) return status;
    } catch {
      // Uncertain transport is observed with the same id, never re-submitted.
    }
    if (!options.cancelled()) await options.delay(3_000);
  }
  return null;
}
