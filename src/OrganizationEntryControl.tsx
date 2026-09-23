import {useEffect, useState} from 'react';
import {Button} from '@fluentui/react-components';

export type OrganizationEntry = {
  identifier: string; enabled: boolean; eligible: boolean; editable: boolean;
  configured: boolean; reason: string; version: number;
  highest_business_access?: boolean;
};
export type OrganizationEntries = {items: OrganizationEntry[]; version: number; updated?: number};

export function OrganizationEntryControl({row, busy, onSave}: {
  row?: OrganizationEntry; busy: boolean; onSave: (identifiers: string[], enabled: boolean) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(!!row?.enabled);
  useEffect(() => setEnabled(!!row?.enabled), [row]);
  return <div className="organization-entry-control">
    <label><input type="checkbox" checked={enabled} disabled={busy || !row?.editable || (!row.eligible && !enabled)} onChange={e => setEnabled(e.target.checked)} />
      <span><strong>组织经营看板</strong><small>{row ? row.reason : '正在读取看板权限；暂不可修改'}</small></span></label>
    <div className="organization-entry-actions"><span>{row?.highest_business_access ? '最高权限 · 完整部门视角' : `${row?.configured ? '独立配置' : '沿用原规则'} · 不随“全部界面”放开`}</span>
      <Button appearance="secondary" disabled={busy || !row?.editable || enabled === row?.enabled}
        onClick={() => row && void onSave([row.identifier], enabled)}>保存看板权限</Button></div>
  </div>;
}

export function OrganizationEntryBatch({items, selected, busy, onSave}: {
  items: OrganizationEntry[]; selected: string[]; busy: boolean;
  onSave: (identifiers: string[], enabled: boolean) => Promise<void>;
}) {
  const [action, setAction] = useState('keep');
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [action, selected]);
  const blocked = selected.some(id => {
    const row = items.find(item => item.identifier === id);
    return !row?.editable || (action === 'allow' && !row.eligible);
  });
  return <div className="organization-entry-control">
    <label><span><strong>组织经营看板</strong><small>独立保存；不修改已选成员的其他业务界面、角色或中心</small></span>
      <select aria-label="批量设置组织经营看板" disabled={busy} value={action} onChange={e => setAction(e.target.value)}>
        <option value="keep">保持不变</option><option value="allow">允许进入</option><option value="deny">关闭入口</option>
      </select></label>
    <div className="organization-entry-actions"><span>{blocked && action !== 'keep' ? '所选成员包含身份待核验、登录关闭或角色不适用的成员；请调整选择' : '保留各成员原有数据范围'}</span>
      {confirming && <Button appearance="subtle" disabled={busy} onClick={() => setConfirming(false)}>取消</Button>}
      <Button appearance={confirming ? 'primary' : 'secondary'} disabled={busy || !selected.length || action === 'keep' || blocked} onClick={() => {
        if (!confirming) { setConfirming(true); return; }
        void onSave(selected, action === 'allow').then(() => setConfirming(false));
      }}>{confirming ? `确认${action === 'allow' ? '允许' : '关闭'} ${selected.length} 人看板` : '应用看板权限'}</Button></div>
  </div>;
}
