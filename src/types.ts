export type ModuleStatus = "online" | "beta" | "building";

export type ModuleTone = "violet" | "teal" | "amber";

export type ModuleFeature = {
  title: string;
  description: string;
};

export type AppModule = {
  id: string;
  index: string;
  title: string;
  kicker: string;
  description: string;
  purpose: string;
  tone: ModuleTone;
  status: ModuleStatus;
  features: ModuleFeature[];
  url?: string;
  actionLabel: string;
};

export type OaUser = {
  number?: string;
  userId?: string;
  id?: string;
  realName?: string;
  name?: string;
  groupName?: string;
  parentDept?: string;
  deptName?: string;
  department?: string;
  center?: string;
  jobTitle?: string;
  job_title?: string;
  positionName?: string;
  position?: string;
  postName?: string;
  avatarUrl?: string;
  avatar_url?: string;
  headImg?: string;
  photo?: string;
  status?: string;
};

export type HubSession = {
  user: OaUser;
  permissions: {
    super_admin: boolean;
    operation_admin: boolean;
    manage_permissions: boolean;
  };
  access: {
    master_access: boolean;
    access_mode: "all" | "selected";
    allowed_modules: string[];
    modules: Array<{ key: string; label: string; purpose: string }>;
    policy_source?: { title: string; url: string; sheetId: string; revision: number };
    policy_state?: string;
  };
  workspace: {
    role: "director" | "manager" | "specialist" | "maintainer" | "external";
    role_label: string;
    home: "department" | "center" | "personal" | "modules";
    dashboard_scope: DashboardScope | "none";
    department: string;
    center: string;
    manager: string;
    is_brand_department: boolean;
    is_system_maintainer: boolean;
    can_configure_workflow?: boolean;
    can_view_organization_dashboard: boolean;
    can_view_spark_library?: boolean;
    spark_role?: "director" | "manager" | "specialist" | "maintainer" | "external";
    can_view_public_summary: boolean;
    module_policy_state: string;
    policy_source: { title: string; url: string; sheetId: string; revision: number };
  };
};

export type WorkspaceHomeSummary = {
  status: "ready" | "partial" | "stale" | "pending";
  generatedAt: string | null;
  totalGsvYuan: number | null;
  channels: Array<{
    key: string;
    label: string;
    todayDate?: string | null;
    sourceUpdatedAt?: string | null;
    todayTotalYuan: number | null;
    state: "ready" | "pending";
  }>;
  note: string;
};

export type TaskCenterSourceKind = "creative_radar" | "video_link" | "video_file" | "text" | "meeting_action" | "business_anomaly" | "live_session";

export type TaskCenterStatus = "opportunity" | "pending_claim" | "in_progress" | "pending_review" | "approved" | "rework" | "pushed" | "completed" | "cancelled";

export type TaskCenterEvent = {
  action: string;
  from?: string;
  to?: string;
  note?: string;
  by: string;
  byNumber: string;
  at: string;
};

export type TaskCenterItem = {
  id: string;
  version: number;
  workflow: string;
  lane: "action" | "content";
  acceptance: string;
  sourceReference?: string;
  legacyUnverified: boolean;
  primaryOwner: { number: string; name: string } | null;
  collaborators: Array<{ number: string; name: string }>;
  outputs: Array<{ id: string; assetId: string; assetVersion: string; url: string; productionJobId: string; summary: string; createdAt: string; cloudSnapshot?: { id: string; version: string } }>;
  reviews: Array<{ id: string; outputId: string; decision: string; by: string; note: string; at: string }>;
  deliveries: Array<{ id: string; outputId: string; assetId: string; assetVersion: string; platform: string; accountId: string; planId: string; state: string; receiptId?: string; receiptUrl?: string }>;
  feedback: Array<{ id: string; businessDate: string; coverage: string; sourceUrl: string; metrics: Record<string, number | null> }>;
  center: string;
  kind: "opportunity" | "formal";
  status: TaskCenterStatus;
  sourceKind: TaskCenterSourceKind;
  sourceUrl: string;
  title: string;
  description: string;
  dueAt: string | null;
  assignees: Array<{ number: string; name: string }>;
  assignee: { number: string; name: string } | null;
  attachment: {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    contentUrl: string;
  } | null;
  externalNotificationState: "pending_integration" | "ready";
  createdBy: { number: string; name: string; role: string };
  createdAt: string;
  updatedAt: string;
  events: TaskCenterEvent[];
};

export type TaskCenterOverview = {
  schemaVersion: number;
  preview?: boolean;
  capabilities?: { writesEnabled?: boolean; aiConfigured: boolean; canMaintain: boolean; deliveryAdapterConfigured: boolean };
  templates: Array<{ id: string; title: string; acceptance: string; lane: string }>;
  alerts: Array<{ taskId: string; title: string; kind: string }>;
  assistance: Array<{ id: string; taskId: string; status: string; stage: string; createdAt: string }>;
  generatedAt: string;
  pilot: {
    center: string;
    state: "pilot";
    notificationChannel: "in_hub";
    externalNotificationState: "pending_integration" | "ready";
    note: string;
  };
  access: {
    role: HubSession["workspace"]["role"];
    canManage: boolean;
    personNumber: string;
    personName: string;
  };
  opportunities: TaskCenterItem[];
  tasks: TaskCenterItem[];
  assignees: Array<{ number: string; name: string }>;
};

export type TaskAssistantResult = {
  id: string; state: string; kind: string; note: string; stale?: boolean;
  sources?: Array<{ id: string; title?: string; text?: string; url?: string }>;
  technical?: { state: string; note: string; checks: Array<{ name: string; state: string }> };
  result?: { brief?: string; checklist?: string[]; summary?: string; risks?: Array<{ location: string; reason: string; sourceId: string }>; missing: string[] };
};

export type DashboardScope = "department" | "center" | "personal";

export type PermissionPreviewSubject = {
  organizationEntryAllowed?: boolean;
  userNumber: string;
  realName: string;
  department: string;
  center: string;
  jobTitle: string;
  mappedRole: string;
  sparkRole?: string;
  manager: string;
  allowedModules: string[];
  loginActive: boolean;
  note: string;
  sourceSheet: string;
};

export type PermissionPreview = {
  active: boolean;
  scope: DashboardScope | "real";
  center: string;
  person: string;
  label: string;
  subject: PermissionPreviewSubject | null;
  updatedAt: string | null;
};

export type DashboardAccess = {
  scope: DashboardScope;
  label: string;
  department: string;
  center: string;
  centers: string[];
  personName: string;
  configured: boolean;
  previewed?: boolean;
};

export type CreativeIncentiveMilestone = {
  id: string;
  directionId: string;
  pointNumber: number;
  thresholdGmvYuan: number;
  observedGmvYuan: number;
  observedCostYuan: number | null;
  observedRoi: number | null;
  sourceCutoffAt: string | null;
  shareType: "full" | "update";
  shareText: string;
  shareStatus: "draft" | "published";
  publishedByName: string;
  publishedAt: string | null;
  feishuMessageId: string;
  deliveryError: string;
  createdAt: string;
};

export type CreativeIncentiveDirection = {
  id: string;
  directionName: string;
  materialId: string;
  materialName: string;
  creatorNumber: string;
  creatorName: string;
  department: string;
  center: string;
  onlineDate: string;
  originalityStatus: "pending" | "confirmed" | "rejected";
  originalityNote: string;
  confirmedByName: string;
  confirmedAt: string | null;
  copyJudgement: string;
  visualJudgement: string;
  voiceJudgement: string;
  remixPlan: string;
  referenceUrl: string;
  metricStatus: "pending" | "ready" | "stale" | "unmatched";
  latestGmvYuan: number | null;
  latestCostYuan: number | null;
  latestRoi: number | null;
  sourceCutoffAt: string | null;
  sourceUpdatedAt: string | null;
  syncedAt: string | null;
  earnedPoints: number;
  nextThresholdGmvYuan: number;
  milestones: CreativeIncentiveMilestone[];
  createdByName: string;
  createdAt: string;
  updatedAt: string;
};

export type CreativeIncentiveOverview = {
  schemaVersion: number;
  generatedAt: string;
  access: DashboardAccess;
  rule: {
    originality: string;
    pointGmvYuan: number;
    pointRule: string;
    firstShare: string;
    followupShare: string;
    metric: string;
  };
  summary: {
    directionCount: number;
    confirmedCount: number;
    qualifiedCount: number;
    totalPoints: number;
    pendingDraftCount: number;
  };
  groupDelivery: {
    configured: boolean;
    target: string;
    fallback: string;
  };
  directions: CreativeIncentiveDirection[];
  sync?: {
    matched: number;
    unmatched: number;
    generated: number;
    requestedDate: string;
    actualDate: string | null;
    sourceStatus: string;
    candidateBoundary: string;
  };
};

export type MaterialUploadOverview = {
  schemaVersion: number;
  date: string;
  generatedAt: string | null;
  retrievedAt?: string | null;
  status: "ready" | "partial" | "stale";
  sourceMode: "root-data";
  definition: string;
  channels: Array<{
    key: "douyin" | "wechat";
    label: string;
    confirmedAssets: number | null;
    observedAssets: number | null;
    state: "ready" | "partial" | "pending";
    updatedAt: string | null;
    sourceTable: string;
    timeField: string;
    dedupeKey: string;
    metadataCoverage: {
      onlineTimeMaterials: number | null;
      totalMaterials: number | null;
      rate: number | null;
    };
    note: string | null;
  }>;
};

export type OrganizationMemberDashboard = {
  schemaVersion: number;
  generatedAt: string;
  range: { startDate: string; endDate: string; days: number };
  access: {
    scope: DashboardScope;
    centers: string[];
    personName: string;
    serverFiltered: boolean;
  };
  summary: {
    visibleMembers: number;
    mappedMembers: number;
    unmappedMembers: number;
    timesheetMappedMembers?: number;
    averageEffectiveHours?: number | null;
    averageAttendanceHours?: number | null;
    averageScheduledDays?: number | null;
    averagePunchDays?: number | null;
  };
  source: {
    directory: string;
    performance: string;
    performanceState: "ready" | "partial" | "pending";
    performanceNote: string;
    completeThroughDate: string | null;
    timesheet?: {
      title: string;
      url: string;
      baseToken: string;
      tableId: string;
      revision: number | null;
      note: string;
      definition: string;
    } | null;
    timesheetState?: "ready" | "partial" | "pending" | "stale";
    timesheetMode?: "live" | "verified-snapshot" | null;
    timesheetMonth?: string | null;
    timesheetGeneratedAt?: string | null;
    timesheetNote?: string;
  };
  members: Array<{
    personName: string;
    employeeId: string;
    department: string;
    center: string;
    isLeader: boolean;
    leaderCenters: string[];
    performance: {
      state: "ready" | "partial" | "pending" | "unmapped";
      materialCount: number | null;
      qianchuanMaterialCount: number | null;
      videoMaterialCount: number | null;
      totalGmvYuan: number | null;
      qianchuanGmvYuan: number | null;
      videoGmvYuan: number | null;
    };
    signals: {
      workloadScore: number | null;
      vitalityScore: number | null;
      heatScore: number | null;
      saturationScore: number | null;
      state: "ready" | "partial" | "pending";
      note: string;
    };
    timesheet?: {
      state: "ready" | "partial" | "pending" | "stale" | "unmapped";
      monthLabel: string | null;
      averageEffectiveHours: number | null;
      totalEffectiveHours: number | null;
      scheduledDays: number | null;
      punchDays: number | null;
      averageAttendanceHours: number | null;
    };
    daily: Array<{
      date: string;
      materialCount: number | null;
      gmvYuan: number | null;
      state: "ready" | "pending" | "unmapped";
    }>;
  }>;
};

export type MeetingIntelligenceProfile = {
  center: string;
  leader: string;
  state: "ready" | "partial" | "pending";
  vitalityScore: number | null;
  heatScore: number | null;
  saturationScore: number | null;
  evidenceCount: number;
  summary: string;
  evidence: Array<{
    title: string;
    signal: string;
    sourceUrl: string;
  }>;
};

export type DashboardScopeGrant = {
  highest_business_access?: boolean;
  identifier: string;
  real_name: string;
  user_number: string;
  department: string;
  center: string;
  oa_center?: string;
  role: "director" | "manager" | "specialist" | "maintainer" | "external";
  modules: string[];
  version: number;
  editable: boolean;
  login_active: boolean;
  dashboard_scope: DashboardScope;
  configured: boolean;
  inherited_elevated?: boolean;
  updated_by_name: string;
  updated_at: string | null;
};

export type LongTermWorkSourceScope = {
  policy: "messages-and-docx-v1";
  messagesRead: number;
  documentsRead: number;
  referenceOnlyCount: number;
  fullTextScope: string;
  referenceOnlyResources?: Array<{
    url: string;
    title: string;
    type: string;
    state: "reference_only";
    contentRead: false;
    metadataRead: true;
    reason: "non_docx_reference_only";
    note: string;
  }>;
};

export type LongTermWorkRunStatus = {
  runId: string;
  status: string;
  sourceState?: string;
  analysisState?: string;
  windowStart?: string;
  windowEnd?: string;
  messagesRead?: number;
  documentsRead?: number;
  sourceScope?: LongTermWorkSourceScope | null;
  sourceReadAt?: string | null;
  completedBatches?: number;
  totalBatches?: number;
  uncertainBatches?: number;
  roundCount?: number;
  sourceCallsThisRound?: number;
  modelCallsThisRound?: number;
  lastRequestId?: string | null;
  lastError?: string | null;
  canContinue: boolean;
};

export type LongTermWorkSchedulerStatus = {
  schemaVersion: number;
  enabled: boolean;
  timezone: "Asia/Shanghai";
  hour: number;
  minute: number;
  status: "idle" | "running" | "ready" | "error" | "blocked_permission" | "blocked_configuration" | "disabled" | "interrupted" | "partial" | "uncertain" | "budget_exhausted" | "analysis_failed" | "blocked_state" | "blocked_maintenance";
  active?: boolean;
  run?: LongTermWorkRunStatus;
  requestedRun?: LongTermWorkRunStatus;
  requestFound?: boolean;
  requestPending?: string | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastSuccessfulDate: string | null;
  lastReadThroughTime: string | null;
  nextRunAt: string | null;
  messagesRead: number;
  documentsRead: number;
  sourceScope?: LongTermWorkSourceScope | null;
  itemCount: number;
  newCount: number;
  updatedCount: number;
  lastError: string | null;
  sourceChat: { name?: string; chatId?: string; readThroughDate?: string };
  snapshotGeneratedAt: string | null;
  resourceAccessRequired: string;
};

export type LibTvCreditTrend = {
  schemaVersion: number;
  generatedAt: string;
  status: "ready" | "stale" | "auth_required" | "error";
  team: { name: string | null; id: string | null; verified: boolean };
  days: 7 | 30 | 90;
  range: { startDate: string; endDate: string; timezone: "Asia/Shanghai" };
  summary: {
    todayConsumed: number | null;
    consumed: number | null;
    dailyAverage: number | null;
    currentBalance: number | null;
    transactionCount: number | null;
  };
  series: Array<{ date: string; consumed: number | null; transactionCount: number | null }>;
  members: Array<{
    userId: string;
    name: string;
    total: number;
    series: Array<{ date: string; consumed: number }>;
  }>;
  transactions: Array<{
    id: string;
    occurredAt: string;
    userId: string | null;
    userName: string;
    sourceName: string | null;
    modelName: string | null;
    projectName: string | null;
    projectId: string | null;
    taskId: string | null;
    detail: string | null;
    consumed: number;
  }>;
  source: {
    label: string;
    updatedAt: string | null;
    cache: "live" | "stale";
    note: string;
  };
};

export type LibTvCreditAuthStatus = {
  connected: boolean;
  status: "connected" | "auth_required" | "account_selection_required" | "code_sent";
  message: string;
  canConfigure?: boolean;
  maskedPhone?: string;
  retryAfter?: number;
  team?: { id: string | null; name: string; verified: boolean };
};

export type OrganizationSourceRefreshState = {
  state: "ready" | "partial" | "pending" | "stale";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  factsDate: string | null;
  requiredBusinessDate: string | null;
  matchesBusinessDate: boolean;
  nextDueAt: string | null;
  scheduleOverdue: boolean;
  error: string | null;
  note: string;
};

export type RootSourceRefreshState = {
  state: "ready" | "partial" | "pending" | "stale";
  refreshing: boolean;
  failureStatus: number | null;
};

export type OrganizationDashboardOverview = {
  schemaVersion: number;
  generatedAt: string;
  status: "ready" | "partial" | "stale";
  sourceRefresh?: {
    generationId: string | null;
    requiredBusinessDate: string;
    scheduler: { lastAttemptAt: string; nextDueAt: string; updatedAt: string } | null;
    sources: Partial<Record<"organization" | "reportingDirectory" | "meetingEvidence" | "meetingIntelligence", OrganizationSourceRefreshState>>;
  };
  rootRefresh?: {
    requestedDate: string;
    actualBusinessDate: string | null;
    dateMismatch: boolean;
    materials: RootSourceRefreshState;
    realtime: RootSourceRefreshState;
  };
  refresh?: {
    complete: boolean;
    pendingSources: string[];
    startedAt: string;
    updatedAt: string;
    business?: { state: "reading" | "ready" | "waiting" | "unavailable"; pending: boolean; exhausted: boolean; checks: number; note: string } | null;
    pollAfterMs?: number;
  };
  access: DashboardAccess;
  preview?: PermissionPreview;
  sources: Array<{
    key: string;
    label: string;
    state: "ready" | "partial" | "pending" | "stale";
    updatedAt: string | null;
    note: string;
    sourceUrl?: string | null;
    revision?: number | string | null;
    authority?: string;
    coverage?: string;
  }>;
  sourceCoverage: {
    verifiedAt: string | null;
    totalSources: number;
    readySources: number;
    incompleteSources: number;
    conflicts: string[];
    guardrail: string;
  };
  organization: {
    sourceTitle: string;
    sourceUrl: string;
    revision: number | string | null;
    updatedAt: string | null;
    verifiedAt: string | null;
    centers: string[];
    snapshots: Array<{
      key: string;
      label: string;
      headcount: number;
      snapshotMonth: string;
    }>;
    warnings: string[];
    directors: Array<{ name: string; role: string }>;
    leaders: Array<{ center: string; name: string; note?: string }>;
    visibilityNote: string;
  };
  reportingDirectory: {
    sourceTitle: string;
    sourceUrl: string;
    revision: number | string | null;
    updatedAt: string | null;
    verifiedAt: string | null;
    guidance: {
      deadline: string;
      coverage: string;
      updateMode: string;
      fields: string[];
    };
    entries: Array<{
      channel: string;
      center: string;
      owner: string;
      reports: Array<{ title: string; url: string }>;
      dashboards: Array<{ title: string; url: string }>;
      state?: "ready" | "partial" | "pending";
      note?: string;
    }>;
    warnings: string[];
    visibilityNote: string;
  };
  businessVisibility: {
    scope: "all-authorized-roles";
    label: string;
    note: string;
  };
  meetingEvidence: {
    sourceTitle: string;
    sourceUrl: string;
    revision: number | string | null;
    archiveRevision?: number | string | null;
    updatedAt: string | null;
    verifiedAt?: string | null;
    sourceMode: "snapshot" | "verified-snapshot" | "verified-source-table";
    totalRecords: number | null;
    archiveRecords: number | null;
    snapshotDate: string | null;
    dailyRecords: number;
    readableRecords: number;
    blockedRecords: number;
    blankRecords: number;
    unverifiedRecords?: number;
    errorRecords?: number;
    verification?: {
      method: string;
      scope: string;
      note: string;
    };
    visibilityNote: string;
    items: Array<{
      date: string;
      title: string;
      center: string;
      minutesUrl: string | null;
      transcriptUrl: string | null;
      accessState?: "blocked";
      readState?: "readable" | "blocked" | "blank" | "unverified" | "error";
      todo?: string | null;
    }>;
  };
  meetingIntelligence: {
    date: string | null;
    generatedAt: string | null;
    sourceMode: "verified-snapshot" | "verified-source-table";
    coverage: {
      dailyRecords: number;
      readableRecords: number;
      blockedRecords: number;
      blankRecords: number;
      rate: number | null;
      note: string;
    };
    method: string;
    profiles: MeetingIntelligenceProfile[];
    summary: {
      vitalityScore: number | null;
      heatScore: number | null;
      saturationScore: number | null;
      scoredProfiles: number;
      visibleProfiles: number;
    };
    visibilityNote: string;
  };
  longTermWork: {
    schemaVersion: number;
    generatedAt: string;
    sourceMode: "verified-snapshot" | "live-refresh";
    sourceChat: { name: string; chatId: string; readThroughDate: string };
    sourceScope?: LongTermWorkSourceScope | null;
    definition: string;
    visibilityNote: string;
    scheduler?: LongTermWorkSchedulerStatus;
    items: Array<{
      id: string;
      title: string;
      center: string;
      owners: string[];
      startDate: string;
      endDate: string;
      status: string;
      acceptance: string;
      sourceType: string;
      sourceTitle: string;
      sourceUrl: string;
    }>;
  };
  memberDashboard: OrganizationMemberDashboard | null;
  business: BusinessIntelligenceOverview | null;
  omnichannelRealtime: OmnichannelRealtimeOverview | null;
  materialUploads: MaterialUploadOverview | null;
  pendingMetrics: string[];
};

export type OmnichannelRealtimePoint = {
  hour: number;
  hourLabel: string;
  todayHourlyYuan: number | null;
  yesterdayHourlyYuan: number | null;
  todayCumulativeYuan: number | null;
  yesterdayCumulativeYuan: number | null;
};

export type OmnichannelRealtimeSeries = {
  key: "douyin" | "wechat";
  label: string;
  metric: "GSV";
  todayDate: string;
  yesterdayDate: string;
  dataThroughHour: number | null;
  comparisonThroughHour: number | null;
  todayTotalYuan: number | null;
  todayComparisonYuan: number | null;
  yesterdaySameTimeYuan: number | null;
  yesterdayTotalYuan: number | null;
  comparisonPct: number | null;
  todaySpendYuan: number | null;
  yesterdaySameTimeSpendYuan: number | null;
  yesterdayTotalSpendYuan: number | null;
  todaySpendRatioPct: number | null;
  yesterdaySameTimeSpendRatioPct: number | null;
  yesterdayTotalSpendRatioPct: number | null;
  spendRatioComparisonPct: number | null;
  spendCoverage: "complete" | "partial" | "missing";
  yesterdaySpendCoverage: "complete" | "partial" | "missing";
  spendBreakdown: Array<{ key: string; label: string; valueYuan: number | null }>;
  sourceUpdatedAt: string | null;
  state: "partial" | "missing";
  unavailableReason: string | null;
  points: OmnichannelRealtimePoint[];
};

export type OmnichannelRealtimeOverview = {
  schemaVersion: number;
  generatedAt: string | null;
  timezone: "Asia/Shanghai";
  status: "ready" | "partial" | "stale";
  summary: {
    departmentTodayGsvYuan: number | null;
    includedChannels: Array<"douyin" | "wechat">;
  };
  definitions: {
    departmentPerformance: string;
    douyinGsv: string;
    wechatGsv: string;
    qianchuanAttribution: string;
    spendCoverage: string;
    comparison: string;
  };
  quality?: {
    warnings: string[];
    failedSources: string[];
    preservesMissingAsNull: boolean;
  };
  staleReason?: string;
  channels: OmnichannelRealtimeSeries[];
};

export type LoginGrant = {
  configured_active?: boolean;
  login_blocked?: boolean;
  login_blocked_reason?: string;
  identifier: string;
  identifier_type: string;
  real_name: string;
  user_number: string;
  department: string;
  center: string;
  active: boolean;
  source: string;
  granted_by_name: string;
  granted_at: string;
  revoked_at?: string | null;
  last_verified_at?: string | null;
};

export type AdminGrant = {
  identifier: string;
  identifier_type: string;
  real_name: string;
  user_number: string;
  department: string;
  center: string;
  role: string;
  active: boolean;
  protected: boolean;
  granted_by_name: string;
  granted_at: string;
};

export type ModuleAccessGrant = {
  configured_login_active?: boolean;
  login_blocked?: boolean;
  login_blocked_reason?: string;
  highest_business_access?: boolean;
  effective_modules?: string[];
  identifier: string;
  identifier_type: string;
  real_name: string;
  user_number: string;
  department: string;
  center: string;
  login_active: boolean;
  access_mode: "all" | "selected";
  modules: string[];
  updated_by_name: string;
  updated_at?: string | null;
};

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions?: AssistantAction[];
  meta?: AssistantResponse["meta"];
  attachments?: AssistantAttachment[];
  created_at?: string;
};

export type AssistantAttachment = {
  id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  preview_url: string;
  created_at: string;
};

export type AssistantConversation = {
  id: string;
  title: string;
  last_message_preview: string;
  message_count: number;
  created_at: string;
  updated_at: string;
};

export type AssistantAction = {
  type: "open_module";
  module_key: string;
  label: string;
  purpose: string;
};

export type AssistantStatus = {
  configured: boolean;
  provider: string;
  model: string;
  vision_model: string;
  application: string;
  mode: "read_only";
  capabilities: string[];
  allowed_modules: string[];
};

export type AssistantResponse = {
  request_id: string;
  answer: string;
  actions: AssistantAction[];
  meta: {
    provider: string;
    model: string;
    mode: "read_only";
    latency_ms: number;
    context_sources?: string[];
  };
  conversation?: AssistantConversation;
  user_message?: AssistantMessage;
  assistant_message?: AssistantMessage;
};

export type OptimizationInsight = {
  key: string;
  severity: "high" | "medium" | "low";
  category: string;
  title: string;
  summary: string;
  evidence: string[];
  suggestion: string;
  module_key: string;
  prompt: string;
};

export type OptimizationResponse = {
  status: "stable" | "attention" | "stale";
  summary: {
    total: number;
    high: number;
    medium: number;
    low: number;
  };
  snapshot: {
    scanned_at?: string | null;
    sources: string[];
    stale?: boolean;
    modules: { online: number | null; total: number; state?: string; reason?: string };
    assets?: { active: number; trash: number; latest_at?: string | null };
    operations_24h?: {
      total: number;
      failed: number;
      failure_rate: number | null;
      failed_modules: Array<{ module: string; failed: number }>;
    };
    delivery?: Record<string, unknown>;
    permissions?: {
      active: number;
      missing_department: number;
      missing_center: number;
      scoped: number;
    };
  };
  insights: OptimizationInsight[];
};

export type BusinessLineage = {
  state: "linked" | "unlinked";
  note?: string;
  assetId?: number;
  assetName?: string;
  libraryType?: string;
  businessStage?: string;
  source?: string;
  uploadedByName?: string | null;
  deliveryStatus?: string;
  linkedAt?: string | null;
  workstationProvenance?: Record<string, unknown> | null;
};

export type BusinessProduct = {
  standardProductName: string;
  effectiveSalesYuan: number;
  orderCount: number;
  productQuantity: number;
  productLinkCount: number;
  salesSharePct: number;
  mapped: boolean;
};

export type BusinessMaterial = {
  materialId: string;
  materialName: string;
  internalAuthor: string;
  materialSource: string;
  sourcePlatforms: string[];
  advertiserIds: string[];
  gmvYuan: number;
  costYuan: number;
  roi: number | null;
  orderCount: number | null;
  actualPayGmvYuan?: number | null;
  couponInclusiveGmvYuan?: number | null;
  activeDayCount: number;
  maxDailyGmvYuan: number;
  sourceCutoffAt: string;
  sourceUpdatedAt: string;
  lineage?: BusinessLineage;
};

export type BusinessIntelligenceOverview = {
  schemaVersion: number;
  status: "ready" | "partial" | "stale";
  generatedAt: string;
  query: {
    productDate: string;
    materialStartDate: string;
    materialEndDate: string;
    materialDays: number;
  };
  summary: {
    productEffectiveSalesYuan: number | null;
    effectiveOrderCount: number | null;
    productQuantity: number | null;
    wechatProductEffectiveSalesYuan: number | null;
    wechatEffectiveOrderCount: number | null;
    wechatProductQuantity: number | null;
    materialAttributedGmvYuan: number | null;
    materialActualPayGmvYuan?: number | null;
    materialCouponInclusiveGmvYuan?: number | null;
    materialCostYuan: number | null;
    materialRoi: number | null;
    spentMaterialCount: number | null;
    effectiveMaterialCount: number | null;
    effectiveMaterialRate: number | null;
  };
  products: BusinessProduct[];
  wechatProducts: BusinessProduct[];
  topMaterials: BusinessMaterial[];
  quality: {
    unclassifiedProductSalesYuan: number | null;
    productMappedSalesRate: number | null;
    wechatUnclassifiedProductSalesYuan: number | null;
    wechatProductMappedSalesRate: number | null;
    materialNameCoverageRate: number | null;
    materialSourceRowCount: number;
    topCandidateGmvCoverageRate: number | null;
    topMaterialLineageLinkedCount: number | null;
    topMaterialLineageCoverageRate: number | null;
  };
  coverage: {
    product: { state: string; sourceUpdatedAt: string | null; source: string };
    wechatProduct: { state: string; sourceUpdatedAt: string | null; source: string };
    material: { state: string; sourceUpdatedAt: string | null; source: string; sourceFreshness: Record<string, string>; sourceMode?: string };
    warnings: string[];
  };
  definitions: Record<string, string>;
  automation: {
    configured: boolean;
    requestedProductDate: string;
    requestedMaterialDays: number;
    matchesRequest: boolean;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastError: string;
    preservesLastSuccessOnFailure: boolean;
  };
};

export type OperationLog = {
  id: number;
  actor_number: string;
  actor_name: string;
  department: string;
  module: string;
  action: string;
  method: string;
  path: string;
  result: "success" | "failed";
  status_code: number;
  resource_type: string;
  resource_id: string;
  detail: string;
  created_at: string;
};
