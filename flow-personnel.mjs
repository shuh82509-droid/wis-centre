import {readFileSync} from 'node:fs';
const records=JSON.parse(readFileSync(new URL('./flow-personnel-overrides.json',import.meta.url),'utf8')).records;
export const inactiveWorkflowMembers=new Set(records.filter(p=>p.active===false).map(p=>p.number));
