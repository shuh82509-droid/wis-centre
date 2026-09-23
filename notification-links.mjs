const hub='https://hub.fandow.com/yxb/wis-marketing-hub/';
export function notificationLinks(env={}){
 const values={
  remix:env.REMIX_NOTIFICATION_PUBLIC_URL||hub+'modules/material-workbench/',
  cloud:env.CLOUD_NOTIFICATION_PUBLIC_URL||hub+'modules/cloud-manager/',
  creative:env.CREATIVE_NOTIFICATION_PUBLIC_URL||hub+'modules/creative-hub/',
 };
 for(const [source,value] of Object.entries(values)){const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('Invalid notification URL: '+source);values[source]=url.href;}
 return values;
}
