// Business records retain their original identifiers and versions. Only the
// navigation destination follows the deployed hub; access is checked there.
export function flowModuleLocations(env=process.env){
 if(env.HUB_INTEGRATED_MODE!=='1')return {
  cloud:'https://app.fandow.top/fd-026222/wis-video-center/',
  remix:'https://app.fandow.top/fd-026222/wis-marketing-hub/api/launch/material-workbench'
 };
 const flow=new URL(env.FLOW_PUBLIC_URL);
 if(!['https:','http:'].includes(flow.protocol)||flow.username||flow.password||!flow.pathname.endsWith('/workflow-panorama/'))throw Error('Invalid workflow public URL');
 const hub=new URL('../',flow);
 return {cloud:hub.href+'#module=cloud-manager',remix:hub.href+'#module=material-workbench'};
}
