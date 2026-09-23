// W06 is a proposed support workflow, not an enabled HR or employment decision system.
export const hrFlow={id:'06',name:'部门人事管理与人才发展',short:'部门管理',weight:null,level:'待确认',owner:'部门人事管理负责人（待绑定）',module:'目标：人事管理 / OA / 飞书受限资料',trigger:'用人需求、获准招聘、新人入职、转正评审到期、培训需要、本人/主管确认的状态变更、绩效周期、获准调岗或离职事件；分别发起。',goal:'让人才供给、能力培养、人员状态、绩效反馈与交接可追溯，支持六条业务流程，不增加重复填报。',finish:'本次被触发事项有可验证结果、人工决定和必要承接回执；不要求同一员工从招聘一直走到离职才结项。',metric:'招聘关键阶段按期处理率、入职准备完成率、培训实操验收率、绩效证据覆盖率、改进动作验收率、离岗交接完整率。定义与目标待业务确认，不按 AI 使用次数或积分直接评个人表现。',now:'新增配置建议；现有 OA/飞书人员身份可作为待核验来源，但招聘、培训、状态、绩效与人事接口均未作现行能力验收。',target:'先单事项 L2：受限档案、唯一主责、人工审批、交接和回执；AI 仅作证据整理与培训辅助，成熟度及权重待确认。',relation:'8 类事项独立触发；批准招聘才关联入职，转正到期另起评审，绩效改进按需关联培训。W04 复用同一 person_id / anchor_id；00–05 只传可证实的业务成果引用。原六条历史权重与 36.0 分不变。'};
export const hrPrivacy='人员本人只看自己的已确认目标、培训任务与允许反馈；主管按实际授权看本中心/直属范围；受限人事资料只给获授权办理人。简历、薪酬、评价、申诉和离职原因不进入公开看板或群通知。核心维护人只接收身份和权限工单所需最小字段，不因维护权限自动获得人事评价权限。';
export const hrNotice='目标：仅通知当前分支的实际办理人，内容只含事项类型、截止和受限任务链接；权限校验后查看细节，不在群里发送简历、评价或薪酬。通知事件去重，发送与承接分开保存。当前自动通知未启用，过渡由获授权上游点对点交接并登记。';
export const hrTriggers=[
 '新增岗位/缺编、业务计划变化且提需人确认时；无需求不发起。',
 '用人需求已获批准且招聘启动边界明确；不自动向全员或候选人群发。',
 '入职确认触发入职分支；试用期评审日期触发独立转正分支。',
 '新人培养、主管确认能力缺口、绩效改进、直播复盘或岗位变化提出培训需求。',
 '本人申报、主管核实或获授权 OA 状态事件；不从聊天语气推断心理/健康状态。',
 '新绩效周期或获准目标变更触发目标分支；周期结束触发评议分支。',
 '本人发展申请、主管建议或经批准的岗位/中心调整提案。',
 '已经有权人员确认的离职/离岗办理事项；不由绩效低分或 AI 建议自动发起。'
];
export function makeHR({X,S,R,F,V}){
 const entry='目标：中枢 → 部门人事管理；当前使用已有获授权的 OA/飞书受限记录，尚未验证专用页面/API';
 const stage=(title,owner,output,steps)=>S('06',title,owner,'待建设','新增方案，人员、表/API、审批与通知均待绑定和验收；现有授权资料可作人工过渡。',output,steps);
 return [
 stage('用人需求与编制','部门用人负责人','有权限依据的岗位需求决定',[
 X('提交岗位需求说明','人工','本次用人提需主管',entry,[F('业务目标与任务负荷依据','原六条工作流的核实记录'),R('获准现有编制信息','OA/人事正式记录')],F('岗位需求书','岗位职责、中心、缺口、人数、任职要求与预算引用'),'需求有真实业务依据、岗位职责和验收人，人数与预算未确认则明示待批。','headcount_request_id,job_profile_version,center_id,requested_count,business_evidence_refs,budget_ref','提交有权审批人；资料不全退提需人，不自动建招聘任务。'),
 X('决定岗位需求与编制','人工','具备用人审批权的负责人',entry,[F('岗位需求书','上一节点'),R('编制与预算授权版本','正式权限规则')],F('用人审批决定','通过/退回/否决/升级及批准数量、期限和范围'),'决定人权限可核实，决定与有效范围保存；通过才允许创建招聘事项。','headcount_decision_id,approver_id,decision,approved_count,approval_scope,valid_until','通过按核准岗位关联 S2；退回原需求，否决结项，超范围升级，不自动增编。')]),
 stage('招聘与录用','本次招聘负责人','经人工决定的录用结论',[
 X('初筛候选资料','人工','招聘经办岗位',entry,[R('批准岗位需求','S1 或已有有效需求'),F('授权接收的候选材料','正式招聘渠道','1–N 份，按实际候选人')],F('候选初筛记录','逐人按已确认任职要求评估并留依据'),'候选资料来源与使用范围可核实；按岗位要求记录，信息缺失不伪造。','recruitment_case_id,candidate_id,job_profile_version,screening_evidence_refs,screening_decision','符合本轮条件交面试安排；不符合由招聘主责明确处置并按保留规则留档。'),
 X('确认面试安排','人工','招聘协调岗位',entry,[F('候选初筛记录','上一节点'),V('双方可用时间及指定面试官','当次明确确认')],R('面试安排记录','获确认的时间、方式、面试官与材料范围'),'候选人与面试官确认安排；不能以邀请已发送冒充确认。','interview_id,candidate_id,interviewer_id,scheduled_at,confirmation_refs','冲突调整同一面试记录；缺席由主责改期/结项，不无限重发。'),
 X('完成人工面试评估','人工','本轮指定面试官',entry,[R('确认面试安排','上一节点'),F('岗位面试标准','确认版本')],F('面试评估','与岗位要求对应的证据、意见及未知项'),'实际面试/考核完成，意见可追溯；不以 AI 预测、外貌或无依据印象自动筛选。','interview_assessment_id,interviewer_id,assessment_version,job_evidence_refs,assessment_limits','交录用决定人；需复试则新建已授权轮次，不跳过确认。'),
 X('作出录用决定','人工','具备录用审批权的负责人',entry,[F('本轮面试评估','上一节点'),R('岗位与待遇审批依据','获授权正式记录')],F('录用决定','批准/补充评估/不录用及权限依据'),'由有权人员决定并留档；正式 offer/劳动安排按公司既有流程办理，AI 不代为承诺。','hiring_decision_id,candidate_id,decision,authorized_decider_id,offer_approval_ref','批准且本人接受、入职信息确认后才关联 S3；拒绝/撤回单独记录，无限等待设截止。')]),
 stage('入职与转正','新人入职与培养负责人','入职就绪回执或独立的转正评审决定',[
 X('登记获确认的入职信息','人工','人事入职经办岗位',entry,[F('正式录用接受与入职依据','正式人事记录'),R('已有身份匹配结果','OA/飞书员工 ID，未生成时标待办理')],R('人员档案引用','同一人员主键、中心、岗位与入职日期'),'来源确认；候选人转员工须明确匹配 person_id，不按同名自动合并；复用已有档案。','onboarding_case_id,candidate_id,person_id,oa_employee_id,department_id,center_id,job_id,start_date','入职分支转权限需求；必要资料缺失交人事办理，不复制另一人员目录。'),
 X('确认岗位权限需求','人工','新人直属主管',entry,[R('人员档案引用','上一节点'),R('岗位模块与数据范围规则','已批准的角色/中心映射')],F('最小权限申请','身份、角色、中心、必要业务模块与生效范围'),'主管确认范围且必要审批齐全；专员不默认开放全部模块或同事信息。','access_request_id,person_id,role_id,center_id,module_ids,data_scope,approval_ref','批准后交有权维护人；跨部门/总监权限等超范围按实际审批规则处理。'),
 X('配置并核验获批权限','人工','获授权的中枢权限维护人',entry,[F('批准权限申请','上一节点')],R('权限变更回执','变更 ID、准确范围与真实角色读回证据'),'请求范围内开通且真实角色首屏/菜单/接口范围读回一致；失败不重复扩大授权。','access_change_id,person_id,approved_scope,applied_at,role_readback_ref,rollback_ref','入职就绪后本分支结项；权限异常仅恢复原工单。转正不是下一个立即执行节点。'),
 X('完成人工转正评审','人工','具备转正决定权的负责人',entry,[R('到期评审事项及人员档案','独立触发的试用期评审记录'),F('已确认培养目标与实际表现依据','导师/直属主管提供','1–N 份，必选')],F('转正评审决定','有权人工结论、依据、反馈与后续动作'),'按公司已确认程序由有权人员评审并记录；AI 不自动转正或结束雇佣，资料不足明确补充。','probation_review_id,person_id,probation_goal_ref,evidence_refs,decision,decider_id,feedback_ref','决定反馈本人；需要培养关联 S4，新事项另起，转正分支单独结项。')]),
 stage('培训与能力提升','本次培养负责人','有实操结果的培训验收',[
 X('确认培训需求与计划','人工','人员直属主管或指定培养负责人',entry,[F('已确认能力提升需求','本人/主管、新人培养、S6 或 W04 复盘'),R('岗位标准与有效课程资料','已审核 SOP/培训材料','1–N 项，必选')],F('个人培训计划','目标能力、资料、导师、实操作业、验收标准和截止'),'提升目标对应岗位工作，导师与本人知悉；课程访问权限正确，不只填观看时长。','training_plan_id,person_id,skill_goal,course_version,mentor_id,practice_spec,due_at','批准后下发同一训练任务；资料不足退提供者；AI 辅助草拟须人工复核。'),
 X('完成岗位实操练习','人工','本次受训同事',entry,[F('确认培训计划','上一节点'),R('获准练习环境与资料','不使用未经授权生产账号')],R('实操作业版本','文件、录屏或已授权真实任务成果','N 项，按计划必选数量'),'作业可查看且满足提交数量与版本要求；提交不等于训练通过，不强制真实推送广告作为练习。','training_task_id,person_id,practice_artifact_refs,task_result_refs,submitted_at','交导师验收；工具故障保留已有作业并走维护，不把系统失败归为人员不合格。'),
 X('验收能力应用结果','人工','本次指定培训导师',entry,[R('实操作业版本','上一节点','1–N 项，必选'),F('计划中的验收标准','继续传递')],F('培训验收反馈','通过/补练、证据、具体建议和应用观察约定'),'导师按标准检查实际产物；后续应用观察另起，不以签到或视频播放直接判定掌握。','training_review_id,reviewer_id,skill_evidence_refs,review_decision,followup_task_id','通过更新技能证据引用；补练回同任务增版本，必要时关联业务任务检验。')]),
 stage('人员状态与沟通','人员直属主管','经核实的工作状态与沟通动作',[
 X('核实并登记人员状态','人工','获授权人员信息经办岗位',entry,[F('本人申报或正式状态变更依据','OA/获授权人事事件；岗位、在岗、请假/离岗、可用安排')],R('人员状态版本','状态代码、生效范围、来源与有效日期'),'本人/正式来源可核验，区分在职状态和当次可用安排；不采集无关隐私或推断健康/心理状态。','person_id,status_event_id,employment_state,availability_state,effective_at,source_ref,verified_by','变更只通知必要排班/任务主责，业务端仅获得可用状态；冲突转人工核实不覆盖正式记录。'),
 X('确认沟通与支持动作','人工','人员直属主管',entry,[R('已确认的沟通事项','本人诉求/实际工作问题；不必每次状态变化都约谈'),R('必要业务背景','授权可见的任务记录','0–N 项，按需')],F('受限沟通记录','本人确认事项、支持需求、约定动作和跟进时间'),'区分事实与评价，反馈可更正；需要支持的事项有主责，不在公共页面展示谈话细节。','conversation_id,person_id,confirmed_facts,support_action_refs,followup_at,access_scope','无后续动作可结项；有则关联 S4/S7 或工作任务，只传办理所必需资料。')]),
 stage('绩效管理与反馈','本次绩效周期负责人','可申诉、可追溯的绩效反馈与改进任务',[
 X('确认周期目标与口径','人工','人员直属主管',entry,[F('已批准部门/中心目标','部门正式目标版本'),R('人员岗位与职责','当前有效人员档案')],F('个人目标确认记录','目标、计算口径、权重、证据来源、周期及本人确认'),'双方确认实际目标，口径与变更生效规则可追溯；权重须明确，不能事后随意改标。','performance_cycle_id,person_id,goal_version,metric_definition_refs,weights,employee_confirmation_ref','目标分支确认后结项；期末评议独立触发并读取本版本，不因等待期末占用执行节点。'),
 X('整理周期成果证据','AI','本次绩效证据复核岗位',entry,[F('已确认目标口径','本周期 E1 或有效既有记录'),R('可核验业务成果与培训记录','W00–05 任务/回执/数据版本及 S4；授权范围内','1–N 项，缺失明示')],F('绩效事实草稿','目标对应事实、来源、分工与缺口；不含自动评分或人员排名'),'事实有来源与范围，缺失/未映射不作 0；个人贡献须匹配真实主责与协作事实；系统故障单单列，不自动扣分。','performance_evidence_id,person_id,task_refs,receipt_refs,metric_snapshot_refs,contribution_basis,missing_items,model_version','仅生成待复核材料；缺工具由同一负责人手工整理，人工复核后才进入评议，不直接触发奖惩。'),
 X('开展人工绩效评议与反馈','人工','具备本次绩效评议权的负责人',entry,[F('绩效事实草稿','上一节点'),F('本人补充/异议资料','本人提交','0–N 份，按需'),R('评议与复核规则','已批准制度版本')],F('人工绩效反馈','有权人员决定、依据、面谈反馈、本人意见与复核入口'),'人审核证据并作决定，本人意见与是否接受分别记录；AI 不自动评级、调薪或淘汰。','performance_review_id,person_id,human_rating,decision_evidence_refs,reviewer_id,employee_feedback_ref,review_window','决定反馈本人；有异议进入独立复核，无异议但需改进则创建明确改进行动。'),
 X('处理复核与改进交接','人工','本次指定绩效复核负责人',entry,[F('绩效反馈记录','上一节点'),F('异议或改进事项','有复核/改进才运行','1–N 项，条件必选')],F('复核与改进结论','独立复核决定或已承接的改进任务编号'),'异议由适当授权且非原决定人的复核者处理并回告；改进任务有主责、标准、截止和承接证据。','performance_appeal_id,independent_reviewer_id,review_decision,improvement_task_ids,acknowledgement_ref','复核结果仅更正原评价版本并保留历史；培养关联 S4；无复核/改进则本分支不适用，禁止虚构申诉。')]),
 stage('人才发展与岗位调整','部门人才发展负责人','已授权的发展决定及职责交接',[
 X('评审发展与岗位调整','人工','具备发展/调岗审批权的负责人',entry,[F('发展申请或调整提案','本人或主管确认'),R('岗位标准及能力证据','获准培训、实际成果与正式岗位需求')],F('人才发展决定','发展路径/导师/岗位调整决定、依据与生效边界'),'有权人员综合评审并沟通；AI 不自动晋升、调岗或作人员淘汰决定。','development_case_id,person_id,skill_evidence_refs,proposed_job_id,decision,approver_id,effective_at','批准才交接新职责；不通过/退回留档，需培训按需关联 S4。'),
 X('落实获准职责与交接','人工','本次岗位调整交接主责',entry,[F('获批发展/调岗决定','上一节点'),R('本人未完成任务与资产清单','授权范围内')],R('岗位调整交接回执','接收人承接、岗位版本及权限子工单核验引用'),'转交对象明确接收，人员记录来源一致；权限变更由独立有权维护人办理并取得回执，不给交接人扩大权限。','job_change_id,person_id,old_job_id,new_job_id,handover_task_ids,receiving_owner_id,acceptance_refs,access_change_receipt_ref','新岗位权限调用 S3 的获批权限分支 E2→E3，禁止重跑入职/转正；不遗失原任务或历史结果。')]),
 stage('离职与工作交接','本次离岗交接负责人','任务与资产交接、授权撤销均可核验',[
 X('确认离岗办理范围','人工','获授权的人事离岗经办岗位',entry,[F('正式获确认的离岗依据','公司既有人事流程，不以系统评分替代'),R('本人待办/素材/账号责任范围','获准查询')],F('离岗办理清单','生效时间、待交事项、指定承接人与权限处置范围'),'办理依据与范围经有权人确认；正常离职、临时离岗、岗位调整区分，未确认不得自动关停账号。','offboarding_case_id,person_id,authorized_event_ref,effective_at,handover_scope,access_revoke_scope','清单通过进入交接；涉及紧急安全撤权由独立获授权处置决定，并保留待交事项不删除业务资产。'),
 X('验收任务与资产交接','人工','本次指定业务接收负责人',entry,[F('离岗办理清单','上一节点'),R('任务、素材和必要操作说明','原业务系统真实记录','1–N 项，按清单；无项须确认')],R('交接验收回执','逐项已承接/缺失/待处理、版本与新主责'),'接收者能访问并确认必交内容，新任务主责已承接；私密人事材料不转交业务同事，资产不以离职为由删掉。','handover_id,receiving_owner_id,task_owner_change_refs,asset_refs,accepted_items,unresolved_items','必交缺项转明确责任与升级；已授权紧急撤权可先走 E3，剩余交接不能伪造完成。'),
 X('撤销并核验到期授权','人工','获授权的账号/权限维护人',entry,[F('获批撤权范围与生效依据','S8.E1 已批准清单'),R('交接回执或紧急处置批准','S8.E2；紧急情况替代依据')],R('撤权核验回执','准确账号/角色、已执行范围与接口/会话读回证据'),'仅撤销已批准权限，核验旧会话及受控模块不再可访问；账号档案和历史业务证据依保留规则处理，不直接删除素材。','access_revocation_id,person_id,approved_scope,revoked_at,session_revoke_ref,verification_ref,retention_rule_version','配置失效转维护故障并升级有权负责人；撤权与交接分别记状态，全部必选结果核验后才结项。')])
 ];
}

export function configureHR(stages){
 const hs=stages.filter(s=>s.flow==='06');
 hs.forEach((s,i)=>{
  s.trigger=hrTriggers[i];s.condition=s.trigger;s.privacy=hrPrivacy;s.notice=hrNotice;
  s.executionMode=[2,4,5].includes(i)?'conditional':'sequential';
  s.returnRule='返回本次事项的具体节点补充/更正；关联原 person_id、事项 ID 与版本，不重建整条人员生命周期。';
  s.terminationRule='撤回、否决或终止由该事项有权人记录依据、剩余风险与必要通知；不能用任务超时自动作不录用、不转正、降级或离职决定。';
  s.steps.forEach((x,j)=>{
   x.notice=hrNotice;x.privacy=hrPrivacy;x.trigger=s.trigger;x.status='待建设';x.sla.escalateTo=s.owner+'（不得扩大敏感资料接收范围）';
   x.forward='仅传递当前分支必需的 person_id / 事项 ID / 获准产物引用；薪酬、简历、评价与谈话原文不复制到业务工作流。';
   x.baseFields.push('person_id','case_id','access_scope','source_version','audit_event_id','retention_rule_version');
   x.next=s.steps[j+1]?.title||'本次事项独立结项；仅按获批决定另起关联事项';
   x.notifyTo=s.steps[j+1]?.owner||'本次事项主责；本人反馈仅按已批准范围点对点送达';
  });
 });
 const by=id=>hs.flatMap(s=>s.steps).find(x=>x.id===id);
 const end=(id,next,notify)=>Object.assign(by(id),{next,notifyTo:notify});
 end('W06.S3.E3','入职/权限分支结项；到期转正评审另起实例','入职经办与本人（仅权限就绪信息）');
 end('W06.S5.E1','状态登记可独立结项；仅有实际沟通事项才运行 E2','必要任务/排班负责人（仅可用状态）');
 end('W06.S6.E1','目标确认分支结项；周期结束另起 E2→E3 评议','本人及本周期绩效负责人');
 end('W06.S6.E3','仅有异议或改进事项才进入 E4；否则结项','本人及获授权绩效经办；异议转独立复核者');
 const routes={
  'W06.S3':[
   {from:'入职事件',to:'W06.S3.E1',condition:'入职确认且必要依据齐全'},
   {from:'W06.S3.E1',to:'W06.S3.E2',condition:'身份确认'},
   {from:'W06.S3.E2',to:'W06.S3.E3',condition:'权限申请获批'},
   {from:'转正到期事件',to:'W06.S3.E4',condition:'独立评审实例，不从 E3 自动进入'},
   {from:'已批准调岗权限事项',to:'W06.S3.E2',condition:'复用权限子流程，不重跑入职/转正'}],
  'W06.S5':[
   {from:'正式状态事件',to:'W06.S5.E1',condition:'本人或正式来源可核实'},
   {from:'已确认沟通事项',to:'W06.S5.E2',condition:'独立触发，不强制每次变更约谈'}],
  'W06.S6':[
   {from:'新绩效周期/批准目标变更',to:'W06.S6.E1',condition:'目标分支确认后独立结项'},
   {from:'周期结束',to:'W06.S6.E2',condition:'独立评议实例，读取有效目标版本'},
   {from:'W06.S6.E2',to:'W06.S6.E3',condition:'证据整理完成，缺口明示待核验'},
   {from:'W06.S6.E3',to:'W06.S6.E4',condition:'存在异议或改进事项；否则结项'}],
  'W06.S8':[
   {from:'W06.S8.E1',to:'W06.S8.E2',condition:'获批正常交接'},
   {from:'W06.S8.E2',to:'W06.S8.E3',condition:'获批撤权范围已生效'},
   {from:'W06.S8.E1',to:'W06.S8.E3',condition:'明确授权的紧急安全处置可先撤权；交接仍待核验'}]
 };
 for(const s of hs)s.nodeRoutes=routes[s.id]||s.steps.slice(0,-1).map((x,j)=>({from:x.id,to:s.steps[j+1].id,condition:'上一节点通过本次必要条件；退回/否决不放行'}));
}
