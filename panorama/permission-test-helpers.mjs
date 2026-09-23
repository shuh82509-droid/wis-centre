import {readFileSync} from 'node:fs';

// Load the actual capability helpers into isolated DOM fixtures. Keeping the
// source slice independent of line length also supports readable functions.
const source=readFileSync(new URL('app.js',import.meta.url),'utf8');
export const permissionHelpers=source.slice(source.indexOf('function canConfigureFlows('),source.indexOf('const labels='));
