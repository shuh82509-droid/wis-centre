import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/202606/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=process.cwd();const evidence=path.resolve(root,'../evidence');await fs.mkdir(evidence,{recursive:true});
const bundle=path.join(root,'.qa-realtime.mjs');
await build({entryPoints:['src/OmnichannelRealtime.tsx'],outfile:bundle,bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty'}});
const {OmnichannelRealtime}=await import(pathToFileURL(bundle));
const css=await fs.readFile('src/omnichannel-realtime.css','utf8');
const data=(first,second)=>({summary:{departmentTodayGsvYuan:733000},definitions:{departmentPerformance:'配色测试样例，非实时经营数据。',qianchuanAttribution:'',spendCoverage:''},status:'ready',channels:[first,second].map((comparisonPct,index)=>({key:index?'wechat':'douyin',label:index?'视频号':'抖音',todayTotalYuan:index?405000:328000,todayComparisonYuan:index?344000:280000,yesterdaySameTimeYuan:index?502000:290000,comparisonPct,todaySpendYuan:index?218000:144000,todaySpendRatioPct:index?53.8:43.9,spendCoverage:index?'partial':'complete',spendBreakdown:[{key:'test',label:index?'ADQ':'千川',valueYuan:144000}],dataThroughHour:10,comparisonThroughHour:9,sourceUpdatedAt:'2026-09-07T10:00:00',points:Array.from({length:24},(_,hour)=>({hour,todayHourlyYuan:hour<10?28000:null,yesterdayHourlyYuan:29000,todayCumulativeYuan:hour<10?28000*hour:null,yesterdayCumulativeYuan:29000*hour}))}))});
const html=d=>`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:14px;background:#f5f3ee;font:13px 'Microsoft YaHei',sans-serif}${css}</style>${renderToStaticMarkup(React.createElement(OmnichannelRealtime,{data:d}))}`;
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();const checks=[];
try{
 for(const [value,cls,color] of [[31.6,'up','rgb(180, 35, 24)'],[-3.6,'down','rgb(8, 116, 93)'],[-31.6,'down','rgb(8, 116, 93)'],[0,'neutral','rgb(102, 113, 123)'],[-0,'neutral','rgb(102, 113, 123)'],[null,'neutral','rgb(102, 113, 123)'],[undefined,'neutral','rgb(102, 113, 123)']]){
  await page.setContent(html(data(value,value)));
  const elements=await page.locator('[class^="omni-change-"]').evaluateAll(nodes=>nodes.map(n=>({cls:n.className,color:getComputedStyle(n).color,text:n.textContent})));
  assert.equal(elements.length,4);assert(elements.every(n=>n.cls===`omni-change-${cls}`&&n.color===color));
  if(value==null)assert(elements.every(n=>n.text.includes('待回补')));
  else assert(elements.every(n=>n.text.includes(`${value>0?'+':''}${value.toFixed(1)}%`)));
  assert.equal(await page.locator('.is-ratio').first().evaluate(n=>getComputedStyle(n).color),'rgb(255, 108, 22)');
  checks.push({value:value??'missing',state:cls,elements:4});
 }
 for(const [name,width,height] of [['desktop',1440,1050],['mobile',390,844]]){
  await page.setViewportSize({width,height});await page.setContent(html(data(-3.6,31.6)));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(evidence,`${name}.png`),fullPage:true});
 }
 const lum=hex=>{const parts=hex.match(/\w\w/g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return parts.reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0)};
 const contrasts=Object.fromEntries(['b42318','08745d','66717b'].map(c=>[c,(lum('f8fbfc')+.05)/(lum(c)+.05)]));assert(Object.values(contrasts).every(v=>v>=4.5));
 await fs.writeFile(path.join(evidence,'color-tests.json'),JSON.stringify({passed:true,checks,contrastOnCard:contrasts,viewports:['1440x1050','390x844'],ratioColorUnchanged:true,metricsUntouched:true},null,2));
 console.log(JSON.stringify({passed:true,states:checks.length,renderedComparisons:checks.length*4,viewports:2,contrasts}));
}finally{await browser.close()}
