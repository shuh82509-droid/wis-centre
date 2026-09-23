import test from 'node:test';
import assert from 'node:assert/strict';
import {meetingDocumentReference} from './server-source-refresh.mjs';

test('meeting source reader accepts only Feishu document URLs linked from reviewed meeting records',()=>{
  assert.deepEqual(meetingDocumentReference('https://www.feishu.cn/docx/WyKEd6m2Mo0EIlx646bcPNlRnvk'),
    {type:'docx',token:'WyKEd6m2Mo0EIlx646bcPNlRnvk'});
  assert.deepEqual(meetingDocumentReference('https://www.feishu.cn/wiki/LW5MwceaTiLlc8kmrqXc9BKInjc'),
    {type:'wiki',token:'LW5MwceaTiLlc8kmrqXc9BKInjc'});
  assert.equal(meetingDocumentReference('https://applink.feishu.cn/client/calendar/event/detail?key=abc'),null);
  assert.equal(meetingDocumentReference('https://www.feishu.cn.evil.example/docx/abc'),null);
  assert.equal(meetingDocumentReference('https://www.feishu.cn@evil.example/docx/abc'),null);
  assert.equal(meetingDocumentReference('http://www.feishu.cn/docx/abc'),null);
});
