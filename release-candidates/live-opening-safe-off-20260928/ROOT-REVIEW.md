# 根代理独立复核：安全关闭候选，不是生产上线

日期：2026-09-28。同一任务内审查，不跨任务同步。没有生产切换、授权刷新、正式消息或业务节点操作。

## 代码与实际存储

根代理完整阅读 original→candidate 模块差异、最终 opening-notifications.mjs、实际 WorkflowStore、合成fixture/worker及测试。实际 WorkflowStore从候选镜像只读取得，具跨进程wx锁、同步事务、文件fsync、atomic rename及Linux目录fsync；未修改该存储层。当前源SHA：1d3ea7ab9f9d86ca7566030f577f57abc9f2e16d5507ffd3fc3700e1e8c8b381。

候选先持久 prepared/autoHold，再持久 sending/postIntentAt及读回，最后同步校验后才进入sender fetch。意图不等于实际POST；已知pre-POST失败为unknownfalse/postAttemptedfalse；可信内置adapter真实fetch后不明为unknowntrue/postAttemptedtrue；不可验证custom调用为postAttemptednull，不捏造调用事实。私有WeakMap绑定不可变outcome、请求hash、uuid、invocation beforePost、key及recipient，拒绝copy/mutation/replay伪造成功。未知/旧sending和新autoHold按date+room+kind+recipient防变更key重发；其他scope不被任意冻结。旧无autoHold的有效sent兼容。

结果写入后抛错不可能由当前实例判定全部持久成功；因此新autoHold不会自动释放变更通知或后继群摘要。默认永久hold属于本安全候选的明确功能限制，须后续独立消息/正文/来源/目标读回解除协议；不得称本候选已完成4.9.2。

## 独立Linux重跑

根代理通过批准SSH，实际rootless Docker socket，在既有唯一纯QA目录读取夹具，独立重跑完整86项：86pass、0fail、0cancelled、0skipped、0todo，524.596952ms。包括16:00/23:59、提交前后及读回故障、429/5xx/非法JSON/ID、跨日时钟、伪造能力、结果写后失败群依赖及两个独立Node进程共享实际WorkflowStore、fakePOST后退出再重启。此处fetch为合成函数，非飞书正式消息；不会代替真人回执。

命令（不启动正式服务、无别名、无正式数据、无host socket挂载）：

```sh
docker --host unix:///run/user/1000/docker.sock run --rm --pull never \
  --network none --read-only --user 10001:10001 --cap-drop ALL \
  --security-opt no-new-privileges --tmpfs /tmp:rw,nosuid,nodev,size=64m \
  -v /home/brand-marketing/fandow-apps/fd-026222/runtime/opening-no-retry-qa-20260928.Lugly2/qa:/qa:ro \
  --entrypoint node sha256:880e57976f2fa828e4813493c61041e76df8061f1d08aa6cc9aa595aef2d2ecb \
  --test /qa/opening-no-retry.test.mjs
```

## 镜像完整性独立读回

候选sha256:880e57976f2fa828e4813493c61041e76df8061f1d08aa6cc9aa595aef2d2ecb，linux/amd64。对精确hard-OFF基础e54e3e7c比较，Config完全一致，32原层全部保持，仅加1个COPY模块层至33层。

- /app/server.mjs SHA af21b94baa29c3f245c2ee892b4ff273347645798eb2f4c9500c4419518ee4cd，与原关闭候选一致，enabledfalse。
- /app/opening-notifications.mjs SHA 1d3ea7ab9f9d86ca7566030f577f57abc9f2e16d5507ffd3fc3700e1e8c8b381，与本地最终模块一致。
- /app/workflow-store.mjs SHA 2e1637b0a8f5d0f486a6b0c9de9841b6cce7762e7dedf905338fd0a784546c68。

根代理本地Docker读取尝试无输出，已仅取消该调用；上述结论来自实际批准SSH隔离容器的独立成功重跑，不冒认本地执行成功。

## 结论与发布限制

窄安全修复的代码和隔离测试通过；仍为OFF候选。当前生产路径未因此改变，不解除原异步临时关闭批准；不实现或证明全套signed许可/有效期限/启动实例/真实人员/四房来源/OA/旧通知链接门禁。需要重核实际生产CAS、停止旧同卷RW风险、新鲜停机完整备份及隔离恢复、保留最新数据回滚，并满足真实页面与消息来源核验后，方可评估生产切换。不能用测试、镜像、Git或29固定消息GET代替上线与真人五节点闭环。
