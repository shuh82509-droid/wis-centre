import test from 'node:test';
import assert from 'node:assert/strict';
import {blockText,messageText,safeSourceId} from './server-source-refresh.mjs';

test('extracts only literal Feishu text and stable source identity',()=>{
  const block={block_id:'abc',block_type:2,paragraph:{elements:[
    {text_run:{content:'昨日新增'}},{text_run:{content:'素材反馈'}}]}};
  assert.equal(blockText(block),'昨日新增素材反馈');
  assert.equal(messageText({msg_type:'text',body:{content:JSON.stringify({text:' 原文 '})}}),'原文');
  assert.equal(messageText({msg_type:'image',body:{content:'{}'}}),'');
  assert.equal(safeSourceId('chat','a','b'),safeSourceId('chat','a','b'));
  assert.notEqual(safeSourceId('chat','a','b'),safeSourceId('chat','a','c'));
});
