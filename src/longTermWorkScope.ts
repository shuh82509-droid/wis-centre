import type { LongTermWorkSourceScope } from "./types";

export function workSourceSummary(scope: LongTermWorkSourceScope | null | undefined, messages: number, documents: number) {
  const counts = `${scope?.messagesRead ?? messages} 条消息 · ${scope?.documentsRead ?? documents} 份原文`;
  return scope
    ? `${counts} · ${scope.referenceOnlyCount} 项关联资源仅登记入口`
    : `${counts} · 关联入口范围未记录`;
}
