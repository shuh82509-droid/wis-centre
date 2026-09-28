# 独立审查：OpeningNotifications 安全关闭与结果不明禁重发候选

审查时间：2026-09-28 09:17 UTC（上海时间 17:17）。审查者：当前任务子代理 `/root/sender_final_gate_review`。

## 结论与边界

**本候选的最小“保持 OFF、发送意图可核对、结果不明不自动重发”改动审查通过；已发现的两项候选 P1 均已消除。没有生产发布放行结论。**

审查者仅阅读本任务候选、运行纯内存模拟，并生成本文件；没有生产容器操作、正式数据写入、Git 操作、飞书写入、凭据读取或原生消息 POST。所有模拟的消息、结果和进程退出均是测试证据，不是飞书实际送达、更不是同事本人确认或业务完成。

本候选不是完整的 4.9.2 上线实现，亦不是 4.9.1—4.9.4 或五环节真实业务验收完成。临时关闭的原用户授权问题不能由本代码审查代答。

## 冻结对象

| 对象 | SHA-256 / 身份 |
| --- | --- |
| 候选 `opening-notifications.mjs` | `1d3ea7ab9f9d86ca7566030f577f57abc9f2e16d5507ffd3fc3700e1e8c8b381` |
| 保留的原模块 | `8c1346a53ff70b6d49a0d5a7885645e77dd4914e62ddd3283f802eed36affd1a` |
| 候选 Hard-OFF `server.mjs` | `af21b94baa29c3f245c2ee892b4ff273347645798eb2f4c9500c4419518ee4cd` |
| 保留的原 `server.mjs` | `99f90637fabfb4b18be5d48d8775c2e61a529ddaba5ea107de47fc3b9e0233e7` |
| 测试文件 | `5c9935cded4bc9cea740a22dea53d992c9e03229917d13b7413f40f49ebe09a7` |
| `fixture-support.mjs` | `1db14f71047f6fe87189fb720933ab51a2420cf7de3a82aaea4ce35a5b6e35b9` |
| 测试 worker | `7ba63c6211a68fd22789719bbdfb703fc0f7c42328082e7a9e81be9a8d83b7b9` |
| `QA-TAP.log` | `bd9b2ae62207cfa679568e0ce30d0563dc8a32dc73bd3e87ca77fc44f9782bd2` |

主代理提供的冻结候选镜像为 `sha256:880e57976f2fa828e4813493c61041e76df8061f1d08aa6cc9aa595aef2d2ecb`。审查者未独立启动或检查该镜像，不把镜像存在当作上线。Dockerfile 仅从已准备的安全关闭父候选 `sha256:e54e3e7cbdb8602c8b07129d53b7436fb2edcec91d33c0333c3182ec2825a6cc` 复制本模块；本地保留 Hard-OFF server 与原始源码供核对。

## 关键代码核验

- `server.mjs:3112–3113` 保持 Hard-OFF 与字面量 `enabled:false`，不由三项真实环境开关重新启用。OFF 分支在读取班表、人员或账本前返回。
- `opening-notifications.mjs:45–54`、`103`：既有 key 永不自动重试；`autoHold`、prepared/sending/uncertain/unknown 及有发送尝试而无确证的旧记录，对相同日期、直播间、消息种类、收件人冻结，即使正文或班表变化生成新 key 也不能绕过。旧 row 缺 roomCode/role 时不猜岗位；有旧 room 名称则按该名称兼容，缺上下文时保守关闭。其他明确房间、日期、收件人以及正常旧 sent 历史的隔离夹具通过。
- `99–112`、`126–142`：先持久 prepared 并读回，再持久 sending / `postIntentAt` 并读回。意图阶段 `unknown:false`、`postAttempted:null`，不是实际调用 POST 的证据。`attempts` 在此阶段也是意图计数，不能被解释为飞书发送次数。
- `137–142`、`180–185`：实际 sender 在 await 续段中调用最终同步检查；请求哈希核对和账本读回完成后再取最终时钟，校验来源核验续段的 1 秒边界和业务日期；检查后不再落盘或 await 才调用 fetch。延迟、不可读或门禁不通过时，可信 adapter 返回已知未调用 POST。
- `40–44`、`147–151`：可信 adapter 返回结果由模块私有 WeakMap 绑定请求 hash、UUID、当前 beforePost 函数身份、消息 key、收件 ID 与类型；返回对象冻结，state、unknown、postAttempted、messageId 等关键字段不可篡改。复制、前一调用/其他 scope 复用、完成 barrier 后伪造 sent 或“未发送”均不被信任。未受信 sender 的结果以 `unknown:true / postAttempted:null` 表示调用事实未核验，不伪造已调用消息 POST。
- `168–190`：可信 adapter 在 token、stillValid、持久意图或最终检查失败时给出零 POST / unknown false；调用 fetch 后的 throw、坏 JSON、429、5xx、错误 code、非严格 true 的 ok、缺失/空白/非字符串消息 ID 均冻结为结果不明，不重发。这里的保守冻结不宣称 429 已送达。
- `80–86`、`152–165`：任一持久化或读回未证实时设置实例级 storageBlocked；不会擦除既有意图后盲重试。持久 `autoHold` 在成功或结果落盘失败后也不自动清除，重启和新 key 仍受约束。准备落盘失败且根本未产生记录的场景先保证零 POST，不捏造历史发送记录。
- `38–39`、`104`：新 `autoHold` 私信收据不能释放后继群消息。旧正常 sent 且无 hold 的收据可满足其自身既有依赖；这只是账本谓词，不是独立飞书读回或真人收到证明。

## 独立发现及修复复核

1. **P1：自定义 sender 完成 barrier 后仍可伪造 sent。** 初版纯内存复现：custom sender 调用 beforePost/hash/finalCheck 后返回伪造字段，无 native fetch，却将 direct 和 group 记 sent。最终版本使用私有、调用绑定、冻结的结果能力；伪造、复制、篡改和跨调用复用夹具均通过，不能释放群依赖。
2. **P1：结果事务先变为 sent 再抛错，重启后可释放群消息。** 初版纯内存复现：模拟 rename 后目录 fsync 失败，首实例停止，但新实例将带 autoHold 的 direct sent 当作群依赖。最终版本默认拒绝新 held 收据充当群依赖；before/after 结果落盘故障、重启以及新 group key 夹具均阻断，正常旧无 hold 依赖仍可独立兼容。

最终冻结 SHA 下未发现本最小协议范围内新的 P1/P2。结论不扩大到尚未开发、未取证的完整发布门禁。

## 测试证据与归属

- 审查者独立执行：**82/82 纯内存 contract 测试通过，0 fail / 0 skip**。通过 Windows Node stdin + data URL 加载冻结模块；仅将未被这些夹具使用的 scheduleSessions 导入替换为抛错桩，班表计划明确使用 synthetic fixture。没有写入源码或持久测试账本；没有调用外部 API。四项原生 WorkflowStore 子进程测试明确排除，不能据此宣称它们由审查者实跑。
- 本地 `QA-TAP.log` 读回：**86/86，0 fail / 0 skip**，包括两个时间点的实际 WorkflowStore 两进程竞争与模拟调用后进程退出 / 新 key 重启保持冻结。主代理另报告独立完整 Linux 复跑同为 86/86，使用上述冻结镜像、network none、read-only、非 root、cap drop、no-new-privileges，无正式数据卷；仅隔离 QA 只读目录及必要 scratch。审查者没有把他人的执行归为自己执行。
- 16:00 和 23:59 是隔离故障夹具时刻，不是正式发送许可；23:59 测试通过不表示可以补发过时正式通知。

## 尚未满足，禁止据此启用生产

本窄补仍保留 `hour(now) >= sendHour`；没有完成约定的 signed permit、有效期限、释放 source/recipient manifest、启动实例绑定、严格正式时间窗口及 15:55 门禁。新的 autoHold 私信即使返回成功也默认封锁新 key 和后继群；独立读回解除 hold 的协议尚未交付，不能称完整通知链已可用。

任何发布仍需当轮真实生产路由 / 容器 / 镜像 / StartedAt 的 CAS、正式源表和实时人员与收件身份、独立消息读回、旧同卷 RW 容器隔离、新鲜完整停机备份及恢复验证、保留最新数据的回滚、真实 OA 页面与旧通知链接验收，以及必要的用户授权。候选、测试、HTTP 状态或 Git 交付都不能替代这些条件。本次审查没有证明当前生产已关闭或改变、没有证明同事本人收到或办理，也没有证明完整五环节真实闭环。
