import { startFixture, seedFixture } from './workflow-fixture.mjs';
const fixture=await startFixture({port:Number(process.argv[2] || 3097),defaultRole:process.argv[3] || 'manager'});
await seedFixture(fixture);
console.log(`LOCAL CANDIDATE PREVIEW: ${fixture.base} — all task records are labeled rehearsal; no production credentials or outbound delivery.`);
let closing=false;
const close=async()=>{if(closing)return;closing=true;await fixture.close();process.exit(0);};
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
