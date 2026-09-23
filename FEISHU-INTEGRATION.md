# 来源流程同步与独立飞书通知

本分支合入 2026-09-23 `notification-r52-20260923` 的中枢通知与流程改动，保留目标仓库现有服务启动逻辑。

## 行为

- 一创生产前增加创意来源（07）：脚本编写、组长审核、主管终审与归档。
- 来源业务记录自动建立流程任务，真实状态和审核历史持续同步；二创回传与云管家审核按来源编号关联。
- 来源任务在原业务系统办理，中枢不能伪造完成。
- 独立通知后台读取创意站内通知、云管家审核/视频需求通知和二创生成事件；持久化队列、稳定消息 UUID、重试与送达回执。
- 首次启动记录历史基线，不批量补发旧通知。旧待办失效后停止投递；无唯一有效人员映射时保留待核对。
- 常规来源通知交给独立后台，中枢保留超时、升级和异常提醒。

## 配套项目

- `chuangyi`：经原身份与权限校验的 `GET /api/workflow-source` 接口；审核站内事件沿用原业务实现。
- `erchuang`：设置 `SERVICE_NOTIFICATIONS_ENABLED=true`，生成切片/成片事件。
- `yunguanjia`：审核事件及送达回执字段；设置 `SERVICE_NOTIFICATION_DELIVERY_MODE=external`，避免旧发送循环重复投递。

以上项目均使用各自 `feat/feishu` 分支。本仓库 `integrations/creative-workbench/lib/flow-workflow-source.mjs` 是接口契约测试副本，实际部署源码归创意项目维护。

## 独立通知后台

Node.js 24 运行 `node service-notifications-production.mjs`，无需启动中枢 HTTP 服务。后台监听内部 3000 端口的 `/health`，每 3 秒读取来源并处理队列。以下路径均应通过部署环境配置，持久化目录不得放入镜像或源码：

| 配置 | 用途 |
| --- | --- |
| `NOTIFICATION_CLOUD_DB` | 云管家业务 SQLite 文件（需回写回执） |
| `NOTIFICATION_CREATIVE_DB` | 创意 D1 实际 SQLite 文件（需回写回执） |
| `NOTIFICATION_REMIX_LIBRARY` | 二创素材库 JSON 文件 |
| `NOTIFICATION_DATA_DIR` | 独立持久通知队列目录 |
| `FLOW_BUSINESS_EXPORT_FILE` | 来源快照输出文件，与中枢共享 |
| `FLOW_NOTIFICATIONS_ENABLED` | 显式设为 `true` 才发送飞书 |
| `FEISHU_APP_ID` / `FEISHU_APP_SECRET` | 由部署密钥配置提供 |
| `FEISHU_RECIPIENT_MAP_JSON` | 已核验的工号到飞书账号映射 |
| `NOTIFICATION_ALLOWED_NUMBERS` | 可选发送工号范围，以逗号分隔 |

中枢配置 `FLOW_BUSINESS_SNAPSHOT` 指向共享快照。流程引擎只在该快照新鲜且 `notificationsEnabled=true` 时，自动把 `remix`、`cloud`、`idea` 的常规通知交给独立后台；`SERVICE_NOTIFICATION_OWNERS` 环境变量不会被读取。需要外部协作人员时，在两侧显式配置 `FLOW_EXTERNAL_COLLABORATOR_NUMBERS`，仍需有效 OA 授权及模块权限。生产拒绝本地占位身份替代配置。

消息入口通过 `CREATIVE_NOTIFICATION_PUBLIC_URL`、`REMIX_NOTIFICATION_PUBLIC_URL`、`CLOUD_NOTIFICATION_PUBLIC_URL` 配置，默认是 `https://hub.fandow.com/yxb/wis-marketing-hub/modules/` 下的 `creative-hub/`、`material-workbench/`、`cloud-manager/`。流程消息部署时设置 `FLOW_PUBLIC_URL=https://hub.fandow.com/yxb/wis-marketing-hub/workflow-panorama/`。

## 验证

```bash
node panorama/build.mjs
node --test flow-creative.test.mjs flow-creative-source.test.mjs service-notifications.test.mjs production-sources.test.mjs flow-notice-validity.test.mjs flow-http.test.mjs flow-runtime.test.mjs flow-blueprints.test.mjs flow-permissions.test.mjs
```

测试使用临时文件、内存数据库和模拟飞书响应，不启动业务服务或发送真实消息。发布前应按各服务原部署方式备份数据库和通知队列；代码回滚不自动回滚业务数据。
