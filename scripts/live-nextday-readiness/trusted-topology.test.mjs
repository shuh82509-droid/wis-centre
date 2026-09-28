import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDockerTopologyReader} from './trusted-topology.mjs';

const ROLES=['hub','calendar','dispatch'];
const ROUTES={hub:'/yxb/wis-marketing-hub/',calendar:'/yxb/wis-marketing-hub/modules/live-room-management/',
  dispatch:'/yxb/wis-marketing-hub/modules/dispatch-center/'};
const NOW=Date.parse('2026-09-28T00:45:00Z'),START='2026-09-28T00:44:00.000000000Z';
const sha=x=>createHash('sha256').update(x).digest('hex'),clone=x=>structuredClone(x);
const id=n=>String(n).padStart(64,'0'),image=n=>'sha256:'+id(n);
function fixture({containerPort=80,serverName='hub.fandow.com'}={}){
  const pin={network:{id:id(10),name:'formal-network'},gateway:{id:id(1),name:'formal-gateway',image:image(1),
    configSource:'/srv/config/nginx.conf',configHash:null,loopbackPort:19144,containerPort,serverName},services:{}};
  const policy={containers:{gateway:{id:id(1),image:image(1)}},dataMounts:{},
    gatewayListener:{containerPort,serverName,loopbackPort:19144}};
  ROLES.forEach((role,index)=>{const n=index+2;
    pin.services[role]={id:id(n),name:'formal-'+role,image:image(n),alias:'formal-'+role,port:3000+index,
      dataMount:{type:'bind',source:'/srv/'+role+'-data',destination:'/app/data',name:null}};
    policy.containers[role]={id:id(n),image:image(n),startedAt:START};policy.dataMounts[role]='/srv/'+role+'-data';
  });
  Object.assign(policy.containers.hub,{release:'release-r70-test',liveNextDayInstance:'test-boot-0001'});
  const config=()=>`# configuration file /etc/nginx/nginx.conf:\nworker_processes 1;\nevents {}\nhttp {\nserver { listen ${containerPort}; server_name ${serverName};\n${ROLES.map(role=>
    `location ^~ ${ROUTES[role]} { set $target ${pin.services[role].alias}:${pin.services[role].port}; proxy_pass http://$target; proxy_set_header X-Test "quoted#value"; }`).join('\n')}\n}\n}\n`;
  let nginx=config();pin.gateway.configHash=sha(nginx);policy.gatewayConfigHash=sha(nginx);
  const selected={gateway:pin.gateway,...pin.services};
  const containers=Object.entries(selected).map(([role,p],index)=>({Id:p.id,Image:p.image,Name:'/'+p.name,
    State:{Running:true,Status:'running',Pid:1000+index,StartedAt:START,...(role==='gateway'?{}:{Health:{Status:'healthy'}})},
    Config:{Env:['SECRET=must-not-leak']},
    NetworkSettings:{Networks:{[pin.network.name]:{NetworkID:pin.network.id,Aliases:role==='gateway'?[p.name]:[p.name,p.alias],IPAddress:'172.18.0.'+(index+2)}}},
    Mounts:role==='gateway'?[{Type:'bind',Source:p.configSource,Destination:'/etc/nginx/nginx.conf',RW:false}]:
      [{Type:'bind',Source:p.dataMount.source,Destination:'/app/data',RW:true}],
    HostConfig:{Binds:role==='gateway'?[p.configSource+':/etc/nginx/nginx.conf:ro']:[p.dataMount.source+':/app/data:rw'],Mounts:[],VolumesFrom:null,
      RestartPolicy:{Name:'no'},PortBindings:role==='gateway'?{[containerPort+'/tcp']:[{HostIp:'127.0.0.1',HostPort:String(p.loopbackPort)}]}:{}}}));
  const network=()=>({Id:pin.network.id,Name:pin.network.name,Containers:Object.fromEntries(containers.filter(c=>c.State.Running&&c.NetworkSettings.Networks[pin.network.name]).map(c=>[c.Id,
    {Name:c.Name.slice(1),IPv4Address:c.NetworkSettings.Networks[pin.network.name].IPAddress+'/16',IPv6Address:'',EndpointID:id(Number(c.Id)+10)}]))});
  const f={pin,policy,containers,commands:[],requests:[],psCount:0,clock:()=>NOW,
    phaseChange:null,healthChange:null,execChange:null,nginx:()=>nginx,network};
  f.repinConfig=value=>{nginx=value;pin.gateway.configHash=sha(value);policy.gatewayConfigHash=sha(value);};
  f.execFileImpl=(file,args,options,callback)=>{
    f.commands.push({file,args:clone(args),options});
    if(f.execChange?.({file,args,options,callback}))return {kill(){}};
    let output;
    const command=args.slice(2);
    if(command[0]==='ps'){f.psCount++;f.phaseChange?.(f.psCount);output=containers.map(c=>c.Id).join('\n');}
    else if(command[0]==='inspect')output=JSON.stringify(containers.filter(c=>command.slice(3).includes(c.Id)));
    else if(command[0]==='network')output=JSON.stringify([network()]);
    else if(command[0]==='exec')output=nginx;
    else throw new Error('Unexpected mutator in test');
    queueMicrotask(()=>callback(null,output,''));return {kill(){}};
  };
  f.fetchImpl=async(url,options)=>{
    f.requests.push({url,options});
    let role=ROLES.find(role=>url.includes('172.18.0.'+(ROLES.indexOf(role)+3)))||
      [...ROLES].sort((a,b)=>ROUTES[b].length-ROUTES[a].length).find(role=>url.includes(ROUTES[role]));
    const body={ok:true,app:'formal-'+role,...(role==='hub'?{release:policy.containers.hub.release,
      liveNextDayInstance:policy.containers.hub.liveNextDayInstance}:{})};
    const changed=await f.healthChange?.({url,options,body,role});
    return changed||new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
  };
  f.realpathImpl=async source=>source;
  f.kernelReads=[];f.kernelChange=null;
  const actualMounts=c=>c.Mounts.filter(m=>m.Type!=='tmpfs');
  const statRow=source=>({dev:64771n,ino:BigInt(parseInt(sha(source).slice(0,12),16)),
    isDirectory:()=>!source.endsWith('nginx.conf'),isFile:()=>source.endsWith('nginx.conf')});
  f.kernelFsImpl={
    readTextBounded:async(file,max)=>{f.kernelReads.push(file);let value;
      if(file==='/proc/self/mountinfo')value='1 1 253:3 / / rw - ext4 /dev/root rw\n';
      else{const pid=Number(file.split('/')[2]),c=containers.find(c=>c.State.Pid===pid);
        assert.ok(c,'Only observed PID may be read');
        if(file.endsWith('/stat'))value=pid+' (worker (safe name)) S '+Array(18).fill('0').join(' ')+' 123456\n';
        else if(file.endsWith('/mountinfo'))value='1 1 0:50 / / rw - overlay overlay rw\n'+actualMounts(c).map((m,i)=>
          `${i+2} 1 253:3 ${m.Source} ${m.Destination} ${m.RW?'rw':'ro'} - ext4 /dev/root rw`).join('\n')+'\n';
        else throw new Error('No arbitrary proc file');}
      return await f.kernelChange?.({op:'read',file,value,max})??value;},
    readlink:async file=>{f.kernelReads.push(file);const value='mnt:['+file.split('/')[2]+']';
      return await f.kernelChange?.({op:'link',file,value})??value;},
    stat:async(file,opts)=>{f.kernelReads.push(file);assert.equal(opts.bigint,true);let source=file;
      if(file.startsWith('/proc/')){const pid=Number(file.split('/')[2]),dest=file.slice(file.indexOf('/root')+5),c=containers.find(c=>c.State.Pid===pid);
        source=actualMounts(c).find(m=>m.Destination===dest)?.Source;assert.ok(source);}
      const value=statRow(source);return await f.kernelChange?.({op:'stat',file,value})??value;}
  };
  f.reader=()=>createDockerTopologyReader({pin,policy,clock:f.clock,execFileImpl:f.execFileImpl,fetchImpl:f.fetchImpl,realpathImpl:f.realpathImpl,kernelFsImpl:f.kernelFsImpl});
  f.service=role=>containers.find(c=>c.Id===pin.services[role].id);
  f.extra=({status='exited',source=pin.services.hub.dataMount.source,binds=true,mounts=true,restart='no',type='bind',volumeName}={})=>{
    const row={Id:id(99),Image:image(99),Name:'/old-holder',State:{Running:status==='running',Status:status,Pid:1099,StartedAt:START},
      NetworkSettings:{Networks:{}},Mounts:mounts?[{Type:type,Source:source,Name:volumeName,Destination:'/old-data',RW:true}]:[],
      HostConfig:{Binds:binds?[(type==='volume'?volumeName:source)+':/old-data:rw']:null,Mounts:[],VolumesFrom:null,
        RestartPolicy:{Name:restart},PortBindings:{}}};containers.push(row);return row;
  };
  return f;
}
async function rejected(f,code){await assert.rejects(f.reader()(),e=>e.code===code&&
  !e.message.includes('SECRET')&&!e.message.includes('set $target'));}

test('complete current topology uses only fixed read commands and GET probes; no Env/config escapes',async()=>{
  const f=fixture(),x=await f.reader()();
  assert.equal(x.gateway.health,'healthy');assert.equal(x.gateway.dockerHealth,null);
  assert.equal(x.gateway.healthProvenBy,'formal_route_http');assert.equal(x.gateway.healthProbes.length,3);
  assert.equal(x.services.hub.release,f.policy.containers.hub.release);assert.equal(x.unsafeWriters,false);
  assert.equal(x.observedAt,new Date(NOW).toISOString());assert.equal(f.psCount,2);assert.equal(f.requests.length,12);
  assert.ok(!JSON.stringify(x).includes('SECRET'));assert.ok(!JSON.stringify(x).includes('worker_processes'));
  for(const c of f.commands){assert.equal(c.file,'/usr/bin/docker');assert.deepEqual(c.args.slice(0,2),['--host','unix:///run/user/1000/docker.sock']);
    assert.equal(c.options.shell,false);assert.ok(c.options.timeout<=10000);assert.equal(c.options.maxBuffer,4*1024*1024);
    assert.ok(['ps','inspect','network','exec'].includes(c.args[2]));if(c.args[2]==='exec')assert.deepEqual(c.args.slice(2),['exec',f.pin.gateway.id,'nginx','-T']);}
  for(const r of f.requests){assert.equal(r.options.method,'GET');assert.equal(r.options.redirect,'error');
    assert.ok(r.url.endsWith('/health'));assert.ok(!r.url.includes('feishu'));}
});
test('reader inputs are immutable and no arguments can supply command/URL/ID',async()=>{
  const f=fixture(),read=f.reader();f.pin.gateway.loopbackPort=1;
  await assert.rejects(read('docker run; curl evil'),{code:'read_topology_arguments_forbidden'});assert.equal(f.commands.length,0);
  // Changing the observed endpoint while the original pin is frozen fails.
  f.containers[0].HostConfig.PortBindings['80/tcp'][0].HostPort='1';
  await assert.rejects(read(),{code:'gateway_loopback_binding_drift'});
});
for(const [label,change,code] of [
  ['wrong alias',f=>f.service('hub').NetworkSettings.Networks[f.pin.network.name].Aliases=[],'service_alias_drift'],
  ['wrong image',f=>f.service('calendar').Image=image(88),'container_identity_or_state_drift'],
  ['wrong name',f=>f.service('dispatch').Name='/wrong','container_identity_or_state_drift'],
  ['restart same ID',f=>f.service('hub').State.StartedAt='2026-09-28T00:44:01Z','service_started_at_drift'],
  ['unhealthy service',f=>f.service('hub').State.Health.Status='unhealthy','service_docker_health_invalid'],
  ['gateway not running',f=>{f.containers[0].State.Running=false;f.containers[0].State.Status='exited';},'container_identity_or_state_drift'],
  ['gateway Docker health unhealthy',f=>{f.containers[0].State.Health={Status:'unhealthy'};},'gateway_docker_health_invalid'],
  ['wrong mount',f=>{f.service('hub').Mounts[0].Source='/wrong';f.service('hub').HostConfig.Binds=['/wrong:/app/data:rw'];},'service_data_mount_drift'],
  ['read only mount',f=>{f.service('hub').Mounts[0].RW=false;f.service('hub').HostConfig.Binds=['/srv/hub-data:/app/data:ro'];},'service_data_mount_drift'],
  ['shadow child data mount',f=>f.service('hub').Mounts.push({Type:'tmpfs',Destination:'/app/data/sub',RW:true}),'service_data_mount_shadowed'],
  ['gateway public binding',f=>f.containers[0].HostConfig.PortBindings['80/tcp'][0].HostIp='0.0.0.0','gateway_loopback_binding_drift'],
  ['wrong gateway config mount',f=>{f.containers[0].Mounts[0].Source='/wrong';f.containers[0].HostConfig.Binds=['/wrong:/etc/nginx/nginx.conf:ro'];},'gateway_config_mount_drift'],
  ['unapproved external IP',f=>f.service('hub').NetworkSettings.Networks[f.pin.network.name].IPAddress='8.8.8.8','network_declaration_invalid'],
])test(label+' fails closed before health fetch',async()=>{const f=fixture();change(f);await rejected(f,code);assert.equal(f.requests.length,0);});
test('aliases must have one holder even in stopped/created inventory',async()=>{
  const f=fixture(),old=f.extra();old.NetworkSettings.Networks[f.pin.network.name]={NetworkID:f.pin.network.id,Aliases:[f.pin.services.hub.alias],IPAddress:'172.18.0.99'};
  await rejected(f,'service_alias_drift');
});
for(const status of ['created','exited','running'])test(status+' RW holder is exposed, including restart=no',async()=>{
  const f=fixture();f.extra({status});const x=await f.reader()();assert.equal(x.unsafeWriters,true);
  assert.deepEqual(x.services.hub[status==='running'?'runningRwWriters':'dormantRwContainers'],status==='running'?[id(2),id(99)]:[id(99)]);
  assert.deepEqual(x.services.hub.dormantAutoRestartRw,[]);
});
for(const [label,opts] of [['parent bind',{source:'/srv'}],['child bind',{source:'/srv/hub-data/archive'}],
  ['bind declaration only',{mounts:false}],['mount observation only',{binds:false}],['restartable',{restart:'always'}]])
  test(label+' is included in dormant RW inventory',async()=>{const f=fixture();f.extra(opts);const x=await f.reader()();
    assert.deepEqual(x.services.hub.dormantRwContainers,[id(99)]);assert.equal(x.unsafeWriters,true);});
test('non-overlapping sibling /hub-data-old is not a writer',async()=>{
  const f=fixture();f.extra({source:'/srv/hub-data-old'});assert.equal((await f.reader()()).unsafeWriters,false);
});
test('named volume configured holder is found without live Source mount',async()=>{
  const f=fixture(),m=f.pin.services.hub.dataMount;m.type='volume';m.name='hub-volume';
  f.service('hub').Mounts[0].Type='volume';f.service('hub').Mounts[0].Name='hub-volume';
  f.service('hub').HostConfig.Binds=['hub-volume:/app/data:rw'];
  f.extra({type:'volume',volumeName:'hub-volume',mounts:false});const x=await f.reader()();
  assert.equal(x.unsafeWriters,true);assert.deepEqual(x.services.hub.dormantRwContainers,[id(99)]);
});
for(const [label,change,code] of [
  ['conflicting RO/RW',f=>f.extra().HostConfig.Binds=['/srv/hub-data:/old-data:ro,rw'],'bind_options_ambiguous'],
  ['malformed bind',f=>f.extra().HostConfig.Binds=['/srv/hub-data:/old-data:rw:evil'],'bind_declaration_invalid'],
  ['root bind',f=>f.extra({source:'/'}),'bind_declaration_invalid'],
  ['unknown mount',f=>f.extra().Mounts[0].Type='mystery','mount_declaration_invalid'],
  ['volumes-from',f=>f.extra().HostConfig.VolumesFrom=['holder:rw'],'volumes_from_unsupported'],
  ['conflicting observations',f=>f.extra().HostConfig.Binds=['/different:/old-data:ro'],'mount_declaration_conflict'],
])test(label+' inventory refuses incomplete proof',async()=>{const f=fixture();change(f);await rejected(f,code);});
test('HostConfig.Mounts alone also exposes a configured RW holder',async()=>{
  const f=fixture(),old=f.extra({binds:false,mounts:false});old.HostConfig.Mounts=[{Type:'bind',Source:'/srv/hub-data',Target:'/old-data',ReadOnly:false}];
  assert.deepEqual((await f.reader()()).services.hub.dormantRwContainers,[id(99)]);
});
test('physical bind aliases and parent aliases expose dormant RW holders',async()=>{
  for(const physical of ['/srv/hub-data','/srv','/srv/hub-data/sub']){
    const f=fixture();f.extra({source:'/symlink-alias'});f.realpathImpl=async source=>source==='/symlink-alias'?physical:source;
    const x=await f.reader()();assert.equal(x.unsafeWriters,true);assert.deepEqual(x.services.hub.dormantRwContainers,[id(99)]);
  }
});
test('physical same-source named volumes are treated as holders even with different names',async()=>{
  const f=fixture();f.extra({type:'volume',volumeName:'other-volume',source:'/volume-mountpoint'});
  f.realpathImpl=async source=>source==='/volume-mountpoint'?'/srv/hub-data':source;
  assert.equal((await f.reader()()).unsafeWriters,true);
});
test('unresolvable source metadata is NO-GO and no health requests run',async()=>{
  const f=fixture();f.realpathImpl=async()=>{throw new Error('SECRET permission denied');};
  await rejected(f,'mount_realpath_unavailable');assert.equal(f.requests.length,0);
});
test('a configured named volume without physical source proof cannot silently be ignored',async()=>{
  const f=fixture();f.extra({type:'volume',volumeName:'unresolved-volume',mounts:false});
  await rejected(f,'volume_physical_path_unavailable');assert.equal(f.requests.length,0);
});
test('slow metadata completion fails closed without leaving its read pending',async()=>{
  const f=fixture();let clock=NOW,active=false;f.clock=()=>clock;
  f.realpathImpl=async source=>{active=true;await Promise.resolve();clock+=10001;active=false;return source;};
  await rejected(f,'mount_realpath_timeout');assert.equal(active,false);
});
test('physical path retargeting during collection changes topology even if Docker strings stay identical',async()=>{
  const f=fixture();f.extra({source:'/physical-alias'});f.realpathImpl=async source=>source==='/physical-alias'?
    f.psCount===2?'/srv/hub-data':'/different-physical':source;
  await rejected(f,'topology_changed_during_read');
});
test('running RW source symlink cannot hide an already-mounted historical target after retargeting',async()=>{
  const f=fixture();f.extra({status:'running',source:'/old-symlink'});
  f.realpathImpl=async source=>source==='/old-symlink'?'/unrelated-current-target':source;
  await rejected(f,'running_rw_source_noncanonical');assert.equal(f.requests.length,0);
});
for(const [label,edit,code] of [
  ['commented target',s=>s.replace('set $target formal-hub:3000;','# set $target formal-hub:3000;\n'),'nginx_formal_target_drift'],
  ['commented formal location',s=>s.replace('location ^~ /yxb/wis-marketing-hub/ {','# location ^~ /yxb/wis-marketing-hub/ {'),'nginx_formal_server_ambiguous'],
  ['wrong route',s=>s.replace('formal-hub:3000','formal-calendar:3001'),'nginx_formal_target_drift'],
  ['duplicate formal location',s=>s.replace('server_name hub.fandow.com;','server_name hub.fandow.com; location ^~ /yxb/wis-marketing-hub/ { set $target formal-hub:3000; proxy_pass http://$target; }'),'nginx_formal_server_ambiguous'],
  ['exact health spoof',s=>s.replace('server_name hub.fandow.com;','server_name hub.fandow.com; location = /yxb/wis-marketing-hub/health { return 200; }'),'nginx_competing_route'],
  ['regex competitor',s=>s.replace('server_name hub.fandow.com;','server_name hub.fandow.com; location ~ health { return 200; }'),'nginx_competing_route'],
  ['nested rewrite',s=>s.replace('proxy_pass http://$target;','if ($evil) { rewrite ^ /evil; } proxy_pass http://$target;'),'nginx_formal_route_unsupported'],
  ['include route',s=>s.replace('proxy_pass http://$target;','include /evil; proxy_pass http://$target;'),'nginx_include_unsupported'],
  ['server if rewrite',s=>s.replace('server_name hub.fandow.com;','server_name hub.fandow.com; if ($evil) { return 200; }'),'nginx_server_rewrite_unsupported'],
  ['server include',s=>s.replace('server_name hub.fandow.com;','server_name hub.fandow.com; include /evil;'),'nginx_server_rewrite_unsupported'],
  ['http include',s=>s.replace('http {','http { include /evil;'),'nginx_include_unsupported'],
  ['wrong formal hostname',s=>s.replace('hub.fandow.com','evil.example'),'nginx_host_selection_ambiguous'],
  ['another server selection',s=>s.replace('http {','http { server { listen 80 default_server; server_name hub.fandow.com; location / { return 200; } }'),'nginx_host_selection_ambiguous'],
])test(label+' rejected even with independently matching config hash',async()=>{const f=fixture();f.repinConfig(edit(f.nginx()));await rejected(f,code);assert.equal(f.requests.length,0);});
test('effective config hash independently pinned; changes cannot pass by matching targets only',async()=>{
  const f=fixture();f.repinConfig(f.nginx()+'# approved\n');f.policy.gatewayConfigHash='a'.repeat(64);
  assert.throws(()=>f.reader(),{code:'gateway_policy_drift'});
});
for(const [label,change,code] of [
  ['missing boot',({body})=>{delete body.liveNextDayInstance;},'hub_health_instance_drift'],
  ['wrong boot',({body})=>{body.liveNextDayInstance='other-boot-0000';},'hub_health_instance_drift'],
  ['wrong release',({body})=>{body.release='other-release-00';},'hub_health_instance_drift'],
  ['false ok',({body})=>{body.ok=false;},'health_service_unhealthy'],
])test(label+' rejects HTTP 200 as healthy',async()=>{const f=fixture();f.healthChange=x=>{change(x);};await rejected(f,code);});
test('gateway calendar probe cannot substitute a different service health body',async()=>{
  const f=fixture();f.healthChange=({url,body,role})=>{if(role==='calendar'&&url.includes('127.0.0.1'))body.app='formal-hub';};
  await rejected(f,'gateway_service_health_mismatch');
});
for(const [label,response,code] of [['redirect',()=>new Response('',{status:302,headers:{location:'https://evil'}}),'health_http_invalid'],
  ['text health',()=>new Response('ok',{status:200,headers:{'content-type':'text/plain'}}),'health_content_type_invalid'],
  ['oversize',()=>new Response('x'.repeat(65537),{status:200,headers:{'content-type':'application/json'}}),'health_body_oversize']])
  test(label+' response fails closed with bounded body',async()=>{const f=fixture();f.healthChange=response;await rejected(f,code);});
test('same ID restart during inventory read is rejected',async()=>{
  const f=fixture();f.phaseChange=n=>{if(n===2)f.service('calendar').State.StartedAt='2026-09-28T00:44:01Z';};
  await rejected(f,'service_started_at_drift');
});
test('inventory addition during collection is not accepted',async()=>{
  const f=fixture();f.phaseChange=n=>{if(n===2)f.extra({source:'/srv/unrelated'});};await rejected(f,'topology_changed_during_read');
});
test('boot drift between probes is refused while Docker ID and StartedAt remain unchanged',async()=>{
  const f=fixture();f.healthChange=({body,role})=>{if(f.requests.length>6&&role==='hub')body.liveNextDayInstance='other-boot-0000';};
  await rejected(f,'hub_health_instance_drift');
});
test('shell injection and arbitrary pin fields are rejected before transport',()=>{
  for(const mutate of [f=>f.pin.gateway.name='gateway; rm -rf /',f=>f.pin.services.hub.alias='$(curl evil)',
    f=>f.pin.services.hub.id='--privileged',f=>f.pin.gateway.url='https://evil',f=>f.pin.gateway.configSource='/srv/../secret']){
    const f=fixture();mutate(f);assert.throws(()=>f.reader(),e=>e.name==='TopologyError');assert.equal(f.commands.length,0);}
});
test('private stderr/Env/config are not leaked on command failure',async()=>{
  const f=fixture();f.execChange=({callback})=>{queueMicrotask(()=>callback(new Error('SECRET token nginx config'),null,'SECRET'));return true;};
  await rejected(f,'docker_read_unavailable');
});
test('bounded command output and malformed JSON never surface raw output',async()=>{
  for(const [output,code] of [['x'.repeat(4*1024*1024+1),'docker_output_invalid'],['{"SECRET_TOKEN":"not-json"','docker_json_invalid']]){
    const f=fixture();f.execChange=({args,callback})=>{if(args[2]==='inspect'){
      queueMicrotask(()=>callback(null,output,''));return true;}return false;};await rejected(f,code);
  }
});
test('AbortSignal is the only optional reader argument and pre-abort sends nothing',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort();
  await assert.rejects(f.reader()({signal:controller.signal}),{code:'topology_aborted'});assert.equal(f.commands.length,0);
  await assert.rejects(f.reader()({signal:new AbortController().signal,url:'https://evil'}),{code:'read_topology_arguments_forbidden'});
});
test('external abort terminates a pending Docker observation and returns no evidence',async()=>{
  const f=fixture(),controller=new AbortController();let killed=false;
  f.execFileImpl=(_file,_args,options,callback)=>{options.signal.addEventListener('abort',()=>callback(new Error('SECRET')));
    queueMicrotask(()=>controller.abort());return {kill(){killed=true;}};};
  await assert.rejects(f.reader()({signal:controller.signal}),{code:'topology_aborted'});assert.equal(killed,true);
});
test('abort at final successful nginx read cannot return evidence',async()=>{
  const f=fixture(),controller=new AbortController();
  f.execChange=({args,callback})=>{if(args[2]==='exec'&&f.psCount===2){
    queueMicrotask(()=>{callback(null,f.nginx(),'');controller.abort();});return true;}return false;};
  await assert.rejects(f.reader()({signal:controller.signal}),{code:'topology_aborted'});
});
test('observation and individual probe timestamps are real and not refreshed to completion',async()=>{
  const f=fixture();let calls=0;f.clock=()=>NOW+calls++;
  const x=await f.reader()();assert.ok(Date.parse(x.gateway.checkedAt)<Date.parse(x.observedAt));
  assert.ok(Date.parse(x.services.hub.checkedAt)<Date.parse(x.observedAt));
  assert.ok(x.gateway.healthProbes.every(p=>Date.parse(p.checkedAt)<Date.parse(x.observedAt)));
  assert.equal(new Set(x.gateway.healthProbes.map(p=>p.checkedAt)).size,3);
});
test('global real-clock deadline fails before another command',async()=>{
  const f=fixture();let calls=0;f.clock=()=>NOW+(calls++>1?90001:0);await rejected(f,'topology_deadline');assert.equal(f.commands.length,1);
});
test('Docker timeout aborts and kills the child; late private output is not evidence',{timeout:15000},async()=>{
  const f=fixture();let killed=false,aborted=false;
  f.execFileImpl=(_file,_args,options,callback)=>{options.signal.addEventListener('abort',()=>{aborted=true;callback(new Error('SECRET'));});return {kill(){killed=true;}};};
  await rejected(f,'docker_read_timeout');assert.equal(aborted,true);assert.equal(killed,true);
});
test('hung health read aborts/cancels response within the fixed bound',{timeout:15000},async()=>{
  const f=fixture();let aborted=false,cancelled=false;
  f.fetchImpl=async(_url,options)=>{options.signal.addEventListener('abort',()=>{aborted=true;});
    return new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled=true;}}),{status:200,headers:{'content-type':'application/json'}});};
  await rejected(f,'health_read_timeout');assert.equal(aborted,true);assert.equal(cancelled,true);
});

test('kernel proofs bind inspect PID, exact comm-safe startticks, namespace and mounted dev/ino',async()=>{
  const f=fixture(),x=await f.reader()();
  for(const role of ROLES){const proof=x.services[role].kernelMountIdentity;
    assert.equal(proof.pid,f.service(role).State.Pid);assert.equal(proof.startTicks,'123456');
    assert.equal(proof.mountNamespace,'mnt:['+proof.pid+']');assert.equal(proof.mounts[0].dev,'64771');
    assert.equal(proof.mounts[0].kind,'directory');assert.match(proof.mountinfoSha256,/^[a-f0-9]{64}$/u);}
  assert.ok(f.kernelReads.every(p=>p==='/proc/self/mountinfo'||/^\/proc\/\d+\/(stat|mountinfo|ns\/mnt|root\/)/u.test(p)||p.startsWith('/srv/')));
  assert.ok(!f.kernelReads.some(p=>/environ|cmdline|\/fd\//u.test(p)));
});
for(const [label,change,code] of [
  ['missing inspect PID',f=>{delete f.service('hub').State.Pid;},'kernel_pid_invalid'],
  ['wrong PID in proc stat',f=>{f.kernelChange=({op,file,value})=>op==='read'&&file.endsWith('/stat')?value.replace(/^\d+/u,'999999'):value;},'kernel_process_stat_invalid'],
  ['missing startticks',f=>{f.kernelChange=({op,file,value})=>op==='read'&&file.endsWith('/stat')?value.replace(/123456/u,'unknown'):value;},'kernel_process_stat_invalid'],
  ['actual inode differs',f=>{f.kernelChange=({op,file,value})=>op==='stat'&&file.includes('/root/app/data')?{...value,ino:value.ino+1n}:value;},'kernel_mount_identity_mismatch'],
  ['actual device differs',f=>{f.kernelChange=({op,file,value})=>op==='stat'&&file.includes('/root/app/data')?{...value,dev:value.dev+1n}:value;},'kernel_mount_identity_mismatch'],
  ['source redirected in mountinfo',f=>{f.kernelChange=({op,file,value})=>op==='read'&&file.endsWith('/mountinfo')&&file!=='/proc/self/mountinfo'?value.replace('/srv/hub-data','/srv/redirected'):value;},'kernel_declared_mount_drift'],
  ['undeclared child over protected full mount',f=>{f.kernelChange=({op,file,value})=>op==='read'&&file==='/proc/1001/mountinfo'?value+'98 2 0:9 / /app/data/sub rw - tmpfs tmpfs rw\n':value;},'kernel_protected_mount_shadowed'],
  ['stacked same mountpoint',f=>{f.kernelChange=({op,file,value})=>op==='read'&&file==='/proc/1001/mountinfo'?value+'98 2 253:3 /srv/hub-data /app/data rw - ext4 /dev/root rw\n':value;},'kernel_declared_mount_missing_or_shadowed'],
  ['kernel RO differs from declared RW',f=>{f.kernelChange=({op,file,value})=>op==='read'&&file==='/proc/1001/mountinfo'?value.replace('/app/data rw','/app/data ro'):value;},'kernel_declared_mount_drift'],
  ['proc permission denial',f=>{f.kernelChange=({op,file,value})=>{if(op==='read'&&file.endsWith('/mountinfo'))throw new Error('SECRET EACCES');return value;};},'kernel_metadata_unavailable'],
  ['namespace unavailable',f=>{f.kernelChange=({op,value})=>{if(op==='link')throw new Error('SECRET EPERM');return value;};},'kernel_namespace_unavailable'],
  ['mounted target unavailable',f=>{f.kernelChange=({op,file,value})=>{if(op==='stat'&&file.includes('/root/app/data'))throw new Error('SECRET EACCES');return value;};},'kernel_mount_target_unavailable'],
  ['malformed namespace',f=>{f.kernelChange=({op,value})=>op==='link'?'SECRET malformed':value;},'kernel_namespace_invalid'],
  ['oversized proc metadata',f=>{f.kernelChange=({op,file,value})=>op==='read'&&file.endsWith('/mountinfo')?'x'.repeat(1024*1024+1):value;},'kernel_metadata_oversize'],
])test(label+' is kernel NO-GO before probes',async()=>{const f=fixture();change(f);await rejected(f,code);assert.equal(f.requests.length,0);});
for(const kind of ['namespace','startticks','mountinfo'])test(kind+' changes inside observation and is rejected',async()=>{
  const f=fixture();let count=0;
  f.kernelChange=({op,file,value})=>{
    if(file==='/proc/1001/'+(kind==='namespace'?'ns/mnt':kind==='startticks'?'stat':'mountinfo')&&++count===2)
      return kind==='namespace'?'mnt:[777]':kind==='startticks'?value.replace('123456','123457'):value+'99 1 0:9 / /other rw - tmpfs tmpfs rw\n';
    return value;};await rejected(f,'kernel_process_or_mount_changed');
});
test('inspect PID reuse between full observations cannot pass CAS',async()=>{
  const f=fixture();f.phaseChange=n=>{if(n===2)f.service('hub').State.Pid=2001;};
  await rejected(f,'topology_changed_during_read');
});
test('host directory renamed/replaced during observation is rejected',async()=>{
  const f=fixture();let count=0;f.kernelChange=({op,file,value})=>op==='stat'&&file==='/srv/hub-data'&&++count>1?
    {...value,ino:value.ino+1n}:value;await rejected(f,'kernel_mount_identity_changed');
});
test('unlisted kernel RW parent mount makes another namespace a writer',async()=>{
  const f=fixture();f.extra({status:'running',source:'/srv/unrelated'});
  f.kernelChange=({op,file,value})=>op==='read'&&file==='/proc/1099/mountinfo'?
    value+'99 1 253:3 /srv /hidden-parent rw - ext4 /dev/root rw\n':value;
  const x=await f.reader()();assert.equal(x.unsafeWriters,true);
  assert.deepEqual(x.services.hub.runningRwWriters,[id(2),id(99)]);
});
test('same inode in a distinct namespace and source spelling is still a writer',async()=>{
  const f=fixture();f.extra({status:'running',source:'/srv/alias-directory'});
  let sourceIdentity;f.kernelChange=({op,file,value})=>{
    if(op==='stat'&&file==='/srv/hub-data')sourceIdentity=value;
    return op==='stat'&&(file==='/srv/alias-directory'||file==='/proc/1099/root/old-data')?sourceIdentity:value;};
  const x=await f.reader()();assert.equal(x.unsafeWriters,true);assert.deepEqual(x.services.hub.runningRwWriters,[id(2),id(99)]);
});
test('kernel BigInt inode never rounds to a neighboring unsafe identity',async()=>{
  const f=fixture();f.kernelChange=({op,file,value})=>op==='stat'&&file==='/srv/hub-data'?{...value,ino:9007199254740993n}:
    op==='stat'&&file==='/proc/1001/root/app/data'?{...value,ino:9007199254740992n}:value;
  await rejected(f,'kernel_mount_identity_mismatch');
});
test('slow native metadata completion fails closed and is drained',async()=>{
  const f=fixture();let time=NOW;f.clock=()=>time;f.kernelChange=({op,value})=>{if(op==='stat')time+=10001;return value;};
  await rejected(f,'kernel_metadata_timeout');
});
test('kernel observation time is captured before reads rather than refreshed at completion',async()=>{
  const f=fixture();let counter=0;f.clock=()=>NOW+counter++;
  const x=await f.reader()();assert.ok(Date.parse(x.services.hub.kernelMountIdentity.checkedAt)<Date.parse(x.observedAt));
  assert.ok(Date.parse(x.services.hub.checkedAt)<=Date.parse(x.services.hub.kernelMountIdentity.checkedAt));
});

for(const contract of [{containerPort:80,serverName:'hub.fandow.com'},
  {containerPort:8080,serverName:'_'},{containerPort:8080,serverName:'hub.fandow.com'},
  {containerPort:1,serverName:'a.example'},{containerPort:65535,serverName:'last.example'}])
test('explicit independently fixed listener '+contract.containerPort+'/'+contract.serverName+' is observed exactly',async()=>{
  const f=fixture(contract),x=await f.reader()();
  assert.deepEqual(x.gateway.listener,{...contract,loopbackPort:19144});
  assert.deepEqual(x.gateway.listener,f.policy.gatewayListener);
  for(const r of f.requests)assert.equal(r.options.headers.host,contract.serverName==='_'?'hub.fandow.com':contract.serverName);
  assert.equal(x.gateway.health,'healthy');assert.equal(x.gateway.dockerHealth,null);
  assert.equal(f.requests.length,12);assert.ok(f.requests.filter(r=>r.url.includes('127.0.0.1')).every(r=>r.url.startsWith('http://127.0.0.1:19144/')));
});
for(const address of ['0.0.0.0:8080','[::]:8080'])test('exact pinned listener allows reviewed address '+address,async()=>{
  const f=fixture({containerPort:8080,serverName:'_'});f.repinConfig(f.nginx().replace('listen 8080;','listen '+address+';'));
  assert.deepEqual((await f.reader()()).gateway.listener,f.policy.gatewayListener);
});
test('same pinned IPv4/IPv6 listener port does not permit another port',async()=>{
  const f=fixture({containerPort:8080,serverName:'_'});f.repinConfig(f.nginx().replace('listen 8080;','listen 0.0.0.0:8080; listen [::]:8080;'));
  assert.deepEqual((await f.reader()()).gateway.listener,f.policy.gatewayListener);
});
for(const [label,change,code] of [
  ['legacy pin missing containerPort',f=>{delete f.pin.gateway.containerPort;},'gateway_pin_invalid'],
  ['legacy pin missing serverName',f=>{delete f.pin.gateway.serverName;},'gateway_pin_invalid'],
  ['pin extra fallback port',f=>{f.pin.gateway.fallbackPort=80;},'gateway_pin_invalid'],
  ['policy listener missing',f=>{delete f.policy.gatewayListener;},'gateway_listener_policy_invalid'],
  ['policy listener null',f=>{f.policy.gatewayListener=null;},'gateway_listener_policy_invalid'],
  ['policy listener array',f=>{f.policy.gatewayListener=[];},'gateway_listener_policy_invalid'],
  ['policy containerPort missing',f=>{delete f.policy.gatewayListener.containerPort;},'gateway_listener_policy_invalid'],
  ['policy serverName missing',f=>{delete f.policy.gatewayListener.serverName;},'gateway_listener_policy_invalid'],
  ['policy loopbackPort missing',f=>{delete f.policy.gatewayListener.loopbackPort;},'gateway_listener_policy_invalid'],
  ['policy extra allow fallback',f=>{f.policy.gatewayListener.fallback=true;},'gateway_listener_policy_invalid'],
  ['policy containerPort mismatch',f=>{f.policy.gatewayListener.containerPort=80;},'gateway_listener_policy_drift'],
  ['policy serverName mismatch',f=>{f.policy.gatewayListener.serverName='hub.fandow.com';},'gateway_listener_policy_drift'],
  ['policy loopbackPort mismatch',f=>{f.policy.gatewayListener.loopbackPort=19145;},'gateway_listener_policy_drift'],
  ['policy string containerPort',f=>{f.policy.gatewayListener.containerPort='8080';},'gateway_listener_policy_invalid'],
])test(label+' is refused before any transport',()=>{
  const f=fixture({containerPort:8080,serverName:'_'});change(f);assert.throws(()=>f.reader(),{code});
  assert.equal(f.commands.length,0);assert.equal(f.requests.length,0);assert.equal(f.kernelReads.length,0);
});
for(const value of [0,-1,65536,1.5,'8080',null,NaN,Infinity])test('invalid pinned container port '+String(value)+' cannot fallback',()=>{
  const f=fixture();f.pin.gateway.containerPort=value;assert.throws(()=>f.reader(),{code:'gateway_pin_invalid'});assert.equal(f.commands.length,0);
});
for(const value of ['','localhost','*.fandow.com','.fandow.com','fandow.com.','~^hub','Hub.fandow.com',
  'hub.fandow.com other.example','hub.fandow.com\n','hub..example','bad_.example','-bad.example',
  'bad-.example','a'.repeat(64)+'.example','127.0.0.1','[::1]','https://hub.fandow.com','$(curl evil)','_; return 200'])
test('unreviewed serverName '+JSON.stringify(value)+' is not a pin',()=>{
  const f=fixture();f.pin.gateway.serverName=value;assert.throws(()=>f.reader(),{code:'gateway_pin_invalid'});assert.equal(f.commands.length,0);
});
for(const value of ['127.1','127.0.1','0177.1','0x7f.1','2130706433','0x7f000001','example.123','a.0177'])
test('WHATWG IP or numeric-TLD interpretation '+value+' is refused in pin and independent policy',()=>{
  const f=fixture();f.pin.gateway.serverName=value;f.policy.gatewayListener.serverName=value;
  assert.throws(()=>f.reader(),{code:'gateway_pin_invalid'});
  const p=fixture();p.policy.gatewayListener.serverName=value;
  assert.throws(()=>p.reader(),{code:'gateway_listener_policy_invalid'});
  for(const row of [f,p]){assert.equal(row.commands.length,0);assert.equal(row.requests.length,0);assert.equal(row.kernelReads.length,0);}
});
for(const [label,edit,code] of [
  ['wrong actual hostname',s=>s.replace('server_name _;','server_name other.example;'),'nginx_host_selection_ambiguous'],
  ['multiple actual names',s=>s.replace('server_name _;','server_name _ other.example;'),'nginx_host_selection_ambiguous'],
  ['duplicate actual server_name',s=>s.replace('server_name _;','server_name _; server_name _;'),'nginx_host_selection_ambiguous'],
  ['wildcard actual name',s=>s.replace('server_name _;','server_name *.example;'),'nginx_host_selection_ambiguous'],
  ['commented actual name',s=>s.replace('server_name _;','# server_name _;\n'),'nginx_host_selection_ambiguous'],
  ['old80 actual listener',s=>s.replace('listen 8080;','listen 80;'),'nginx_listener_unsupported'],
  ['mixed port actual listener',s=>s.replace('listen 8080;','listen 8080; listen 80;'),'nginx_listener_unsupported'],
  ['nonreviewed address',s=>s.replace('listen 8080;','listen 127.0.0.1:8080;'),'nginx_listener_unsupported'],
  ['leading zero port',s=>s.replace('listen 8080;','listen 08080;'),'nginx_listener_unsupported'],
  ['variable port',s=>s.replace('listen 8080;','listen $port;'),'nginx_listener_unsupported'],
  ['SSL listener',s=>s.replace('listen 8080;','listen 8080 ssl;'),'nginx_listener_unsupported'],
  ['UDP listener',s=>s.replace('listen 8080;','listen 8080 udp;'),'nginx_listener_unsupported'],
  ['duplicate equivalent listener',s=>s.replace('listen 8080;','listen 8080; listen 0.0.0.0:8080;'),'nginx_listener_unsupported'],
  ['missing listener',s=>s.replace('listen 8080;',''),'nginx_listener_unsupported'],
])test(label+' is rejected even with independently matching exact config bytes',async()=>{
  const f=fixture({containerPort:8080,serverName:'_'});f.repinConfig(edit(f.nginx()));await rejected(f,code);assert.equal(f.requests.length,0);
});
for(const [label,change] of [
  ['wrong old80 binding',bindings=>{bindings['80/tcp']=bindings['8080/tcp'];delete bindings['8080/tcp'];}],
  ['extra public TCP',bindings=>{bindings['443/tcp']=[{HostIp:'0.0.0.0',HostPort:'443'}];}],
  ['extra local TCP',bindings=>{bindings['80/tcp']=[{HostIp:'127.0.0.1',HostPort:'19145'}];}],
  ['extra published UDP',bindings=>{bindings['8080/udp']=[{HostIp:'127.0.0.1',HostPort:'19144'}];}],
  ['duplicate designated mapping',bindings=>{bindings['8080/tcp'].push({...bindings['8080/tcp'][0]});}],
  ['designated public IP',bindings=>{bindings['8080/tcp'][0].HostIp='0.0.0.0';}],
  ['missing designated mapping',bindings=>{delete bindings['8080/tcp'];}],
  ['null designated mapping',bindings=>{bindings['8080/tcp']=null;}],
  ['extra binding-row metadata',bindings=>{bindings['8080/tcp'][0].fallback=true;}],
  ['noncanonical extra key',bindings=>{bindings['08080/tcp']=null;}],
  ['invalid extra protocol',bindings=>{bindings['8080/sctp']=null;}],
])test(label+' cannot hide behind a valid fixed listener',async()=>{
  const f=fixture({containerPort:8080,serverName:'_'});change(f.containers[0].HostConfig.PortBindings);
  await rejected(f,'gateway_loopback_binding_drift');assert.equal(f.requests.length,0);
});
test('other exposed ports may be explicit null or empty but never published',async()=>{
  const f=fixture({containerPort:8080,serverName:'_'});Object.assign(f.containers[0].HostConfig.PortBindings,{'80/tcp':null,'8080/udp':[]});
  assert.deepEqual((await f.reader()()).gateway.listener,f.policy.gatewayListener);
});
for(const kind of ['listener','serverName','published'])test('fixed '+kind+' drift during the second observation cannot return a new contract',async()=>{
  const f=fixture({containerPort:8080,serverName:'_'});
  f.phaseChange=count=>{if(count!==2)return;
    if(kind==='published')f.containers[0].HostConfig.PortBindings['8080/tcp'][0].HostPort='19145';
    else f.repinConfig(f.nginx().replace(kind==='listener'?'listen 8080;':'server_name _;',kind==='listener'?'listen 80;':'server_name other.example;'));};
  await rejected(f,kind==='published'?'gateway_loopback_binding_drift':'gateway_config_hash_drift');
});
