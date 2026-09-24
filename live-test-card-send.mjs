// Explicit one-shot operator command. This process never starts a second
// Feishu WebSocket; the formal Hub service handles the card callback.
import {FlowFeishu} from './flow-feishu.mjs';
import {LiveTestCard,LIVE_TEST_APP_ID} from './live-test-card.mjs';

if(process.argv[2]!=='send-approved-liu')throw new Error('EXPLICIT_APPROVED_LIU_TEST_MODE_REQUIRED');
if(process.env.FLOW_LIVE_FEISHU_CARDS!=='true'||process.env.FLOW_LIVE_TEST_CARD_ENABLED!=='true')
  throw new Error('FORMAL_TEST_CARD_RECEIVER_NOT_ENABLED');
if(process.env.FEISHU_APP_ID!==LIVE_TEST_APP_ID||!process.env.FEISHU_APP_SECRET)
  throw new Error('TEST_APP_CONFIGURATION_MISMATCH');
const notifier=new FlowFeishu(null,{people:()=>[]});
const testCard=new LiveTestCard({appId:notifier.appId,notifier});
const status=await testCard.sendApproved();
console.log(JSON.stringify(status));
