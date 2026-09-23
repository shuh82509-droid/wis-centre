import type { BusinessIntelligenceOverview } from "./types";

export function isOfficialMaterial(data: BusinessIntelligenceOverview | null | undefined) {
  return data?.coverage.material.sourceMode === "verified-official-qianchuan-video-financial-partitions";
}

export function materialGmvLabel(data: BusinessIntelligenceOverview | null | undefined) {
  return isOfficialMaterial(data) ? "含券视频归因成交" : "素材归因 GMV";
}

export function materialOrderCount(value: number | null | undefined) {
  return value === null || value === undefined ? "订单数未提供" : `${value} 单`;
}
