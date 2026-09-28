// Release-host read-only Docker observer. This is not a cutover, permit or
// backup adapter. Pins/policy must be independently reviewed, never derived
// from the observations below. Transport injection exists only for tests.
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {realpath,open,stat,readlink} from 'node:fs/promises';

const ROLES=['hub','calendar','dispatch'];
const ROUTES={hub:'/yxb/wis-marketing-hub/',
  calendar:'/yxb/wis-marketing-hub/modules/live-room-management/',
  dispatch:'/yxb/wis-marketing-hub/modules/dispatch-center/'};
const SOCKET='unix:///run/user/1000/docker.sock';
const OP_MS=10000,TOTAL_MS=90000,MAX_BYTES=4*1024*1024,HEALTH_BYTES=65536;
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x);
const image=x=>typeof x==='string'&&/^sha256:[a-f0-9]{64}$/u.test(x);
const name=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(x);
const alias=x=>typeof x==='string'&&/^[a-z][a-z0-9.-]{2,80}$/u.test(x);
const port=x=>Number.isInteger(x)&&x>=1&&x<=65535;
const serverName=x=>{
  if(x==='_')return true;
  if(typeof x!=='string'||x.length>253||isIP(x)!==0||x.split('.').length<2||
    !x.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label)))return false;
  try{const normalized=new URL('http://'+x).hostname;return normalized===x&&isIP(normalized)===0;}catch{return false;}
};
const path=x=>typeof x==='string'&&x.startsWith('/')&&x.length>1&&x.length<=1000&&
  !x.endsWith('/')&&!x.includes('//')&&!/[\u0000-\u0020\u007f\\:]/u.test(x)&&
  !x.split('/').some(p=>p==='.'||p==='..');
const identity=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(x)&&x!=='local';
const timestamp=x=>typeof x==='string'&&/^20\d{2}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/u.test(x)&&Number.isFinite(Date.parse(x));
const digest=x=>createHash('sha256').update(x).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const overlap=(a,b)=>a===b||a.startsWith(b+'/')||b.startsWith(a+'/');
const privateIp=x=>isIP(x)===4&&(x.startsWith('10.')||x.startsWith('192.168.')||
  x.startsWith('172.')&&Number(x.split('.')[1])>=16&&Number(x.split('.')[1])<=31);
class TopologyError extends Error{constructor(code){super('Read-only topology NO-GO: '+code);this.name='TopologyError';this.code=code;}}
const need=(ok,code)=>{if(!ok)throw new TopologyError(code);};
const keys=(row,expected)=>object(row)&&same(Object.keys(row).sort(),[...expected].sort());
const freeze=x=>{if(object(x)||Array.isArray(x)){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
// Fixed proc metadata only. Never read cmdline, environ, fds or business data.
async function readTextBounded(file,maxBytes){
  const handle=await open(file,'r');
  try{const buffer=Buffer.alloc(maxBytes+1);let length=0;
    while(length<buffer.length){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;}
    need(length<=maxBytes,'kernel_metadata_oversize');return buffer.subarray(0,length).toString('utf8');
  }finally{await handle.close();}
}
const KERNEL_FS=Object.freeze({readTextBounded,stat,readlink});
const mountPath=x=>x==='/'||path(x);
const deviceNumber=dev=>String(((dev>>8n)&0xfffn)|((dev>>32n)&~0xfffn))+':'+String((dev&0xffn)|((dev>>12n)&~0xffn));
function mountInfo(raw){
  need(typeof raw==='string'&&Buffer.byteLength(raw)<=1024*1024,'kernel_metadata_oversize');
  const decode=x=>{need(!/\\(?!040|011|012|134)/u.test(x),'kernel_mountinfo_invalid');
    return x.replace(/\\(040|011|012|134)/gu,(_,x)=>String.fromCharCode(parseInt(x,8)));};
  const rows=raw.trim().split('\n').map(line=>{
    const f=line.split(' '),split=f.indexOf('-');
    need(split>=6&&f.length===split+4&&/^\d+$/u.test(f[0])&&/^\d+$/u.test(f[1])&&/^\d+:\d+$/u.test(f[2]),'kernel_mountinfo_invalid');
    const root=decode(f[3]),destination=decode(f[4]),options=f[5].split(','),superOptions=f[split+3].split(',');
    need(mountPath(root)&&mountPath(destination)&&options.includes('ro')!==options.includes('rw')&&
      superOptions.includes('ro')!==superOptions.includes('rw'),'kernel_mountinfo_invalid');
    return {id:f[0],parent:f[1],device:f[2],root,destination,rw:options.includes('rw')&&superOptions.includes('rw')};
  });
  need(rows.length>0&&rows.length<=10000&&new Set(rows.map(x=>x.id)).size===rows.length,'kernel_mountinfo_invalid');return rows;
}
function processStart(raw,pid){
  need(typeof raw==='string'&&Buffer.byteLength(raw)<=16384&&raw.startsWith(String(pid)+' ('),'kernel_process_stat_invalid');
  const end=raw.lastIndexOf(')'),fields=raw.slice(end+2).trim().split(/\s+/u);
  need(end>0&&raw[end+1]===' '&&fields.length>=20&&/^[RSDZTWtXxIKP]$/u.test(fields[0])&&/^\d+$/u.test(fields[19]),'kernel_process_stat_invalid');return fields[19];
}
function statIdentity(value){
  need(value&&typeof value.dev==='bigint'&&typeof value.ino==='bigint'&&value.dev>=0n&&value.ino>0n&&
    typeof value.isDirectory==='function'&&typeof value.isFile==='function','kernel_stat_invalid');
  const kind=value.isDirectory()?'directory':value.isFile()?'file':null;need(kind,'kernel_mount_kind_invalid');
  return {device:deviceNumber(value.dev),dev:String(value.dev),ino:String(value.ino),kind};
}
const rootOverlap=(a,b)=>a==='/'||b==='/'||overlap(a,b);

function validate(pin,policy){
  need(keys(pin,['network','gateway','services']),'pin_shape_invalid');
  need(keys(pin.network,['id','name'])&&hex(pin.network.id)&&name(pin.network.name),'network_pin_invalid');
  const g=pin.gateway;
  need(keys(g,['id','name','image','configSource','configHash','loopbackPort','containerPort','serverName'])&&
    hex(g.id)&&name(g.name)&&image(g.image)&&path(g.configSource)&&hex(g.configHash)&&
    port(g.loopbackPort)&&port(g.containerPort)&&serverName(g.serverName),'gateway_pin_invalid');
  const listener=policy?.gatewayListener;
  need(keys(listener,['containerPort','serverName','loopbackPort'])&&port(listener.containerPort)&&
    port(listener.loopbackPort)&&serverName(listener.serverName),'gateway_listener_policy_invalid');
  need(listener.containerPort===g.containerPort&&listener.serverName===g.serverName&&
    listener.loopbackPort===g.loopbackPort,'gateway_listener_policy_drift');
  need(keys(pin.services,ROLES)&&object(policy?.containers)&&object(policy?.dataMounts), 'service_policy_missing');
  const ids=[g.id],aliases=[],sources=[],volumes=[];
  need(policy.containers.gateway?.id===g.id&&policy.containers.gateway?.image===g.image&&
    policy.gatewayConfigHash===g.configHash,'gateway_policy_drift');
  for(const role of ROLES){
    const s=pin.services[role],m=s?.dataMount,p=policy.containers[role];
    need(keys(s,['id','name','image','alias','port','dataMount'])&&hex(s.id)&&name(s.name)&&
      image(s.image)&&alias(s.alias)&&Number.isInteger(s.port)&&s.port>0&&s.port<=65535,'service_pin_invalid');
    need(keys(m,['type','source','destination','name'])&&['bind','volume'].includes(m.type)&&
      path(m.source)&&m.destination==='/app/data'&&
      (m.type==='bind'?m.name===null:name(m.name)),'data_mount_pin_invalid');
    need(p?.id===s.id&&p?.image===s.image&&timestamp(p?.startedAt)&&
      policy.dataMounts[role]===m.source,'service_policy_drift');
    ids.push(s.id);aliases.push(s.alias);sources.push(m.source);if(m.type==='volume')volumes.push(m.name);
  }
  need(new Set(ids).size===4&&new Set(aliases).size===3&&new Set(volumes).size===volumes.length&&
    sources.every((s,i)=>sources.every((other,j)=>i===j||!overlap(s,other))),'pin_scope_overlap');
  need(identity(policy.containers.hub.release)&&identity(policy.containers.hub.liveNextDayInstance),'hub_instance_policy_missing');
}

// Tokenize comments and quoted strings correctly; unsupported/ambiguous
// routing constructs are a NO-GO, not a best-effort regex interpretation.
function nginxTree(config){
  const tokens=[];let token='',quote=null,escape=false;
  const flush=()=>{if(token){tokens.push(token);token='';}};
  for(let i=0;i<config.length;i++){
    const c=config[i];
    if(escape){token+=c;escape=false;continue;}
    if(c==='\\'){need(quote!==null,'nginx_escape_unsupported');escape=true;continue;}
    if(quote){if(c===quote)quote=null;else token+=c;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='#'){flush();while(i<config.length&&config[i]!=='\n')i++;continue;}
    if(/\s/u.test(c)){flush();continue;}
    if('{};'.includes(c)){flush();tokens.push(c);continue;}
    token+=c;
  }
  need(!quote&&!escape,'nginx_quote_unclosed');flush();
  let index=0,count=0;
  const parse=(nested=false)=>{
    const rows=[];
    while(index<tokens.length){
      if(tokens[index]==='}'){need(nested,'nginx_brace_invalid');index++;return rows;}
      const words=[];
      while(index<tokens.length&&!['{','}',';'].includes(tokens[index]))words.push(tokens[index++]);
      need(words.length>0&&index<tokens.length&&++count<20000,'nginx_directive_invalid');
      const end=tokens[index++];need(end!=='}','nginx_directive_invalid');
      rows.push({words,children:end==='{'?parse(true):null});
    }
    need(!nested,'nginx_brace_unclosed');return rows;
  };
  return parse();
}
function nginxRoutes(config,pin){
  const tree=nginxTree(config),locations=[],servers=[];
  const walk=(rows,server=null)=>{for(const row of rows){
    if(row.words[0]==='server'&&row.children){servers.push(row);walk(row.children,row);}
    else{if(row.words[0]==='location')locations.push({row,server});if(row.children)walk(row.children,server);}
  }};walk(tree);
  const formal=locations.filter(x=>Object.values(ROUTES).includes(x.row.words.at(-1)));
  need(formal.length===3&&new Set(formal.map(x=>x.server)).size===1&&formal[0]?.server,'nginx_formal_server_ambiguous');
  const selected=formal[0].server;
  need(servers.length===1&&same(selected.words,['server'])&&
    selected.children.filter(x=>x.words[0]==='server_name').length===1&&
    same(selected.children.find(x=>x.words[0]==='server_name').words,['server_name',pin.gateway.serverName]),'nginx_host_selection_ambiguous');
  const listen=selected.children.filter(x=>x.words[0]==='listen');
  const expectedPort=String(pin.gateway.containerPort),listeners=[expectedPort,'0.0.0.0:'+expectedPort,'[::]:'+expectedPort];
  need(listen.length>0&&listen.every(x=>!x.children&&listeners.includes(x.words[1])&&x.words.length<=3&&
    x.words.slice(2).every(y=>y==='default_server'))&&
    new Set(listen.map(x=>x.words[1]===expectedPort?'0.0.0.0:'+expectedPort:x.words[1])).size===listen.length,
    'nginx_listener_unsupported');
  // Reject competing exact/prefix/regex routes and nested rewriting. A
  // pinned config with additional routing needs a separately reviewed parser.
  for(const {row,server} of locations){
    if(server!==selected)continue;
    need(row.children,'nginx_location_invalid');
    if(formal.some(x=>x.row===row))continue;
    const modifier=row.words[1],loc=row.words.at(-1);
    need(!['~','~*','@'].includes(modifier)&&!loc.startsWith('@'),'nginx_competing_route');
    need(!Object.values(ROUTES).some(route=>loc.startsWith(route)||route.startsWith(loc)&&loc!=='/'), 'nginx_competing_route');
  }
  need(!selected.children.some(x=>['rewrite','return','try_files','include'].includes(x.words[0])||
    x.children&&x.words[0]!=='location'),'nginx_server_rewrite_unsupported');
  const includes=rows=>rows.some(x=>x.words[0]==='include'||x.children&&includes(x.children));
  need(!includes(tree),'nginx_include_unsupported');
  const result={};
  for(const role of ROLES){
    const matches=formal.filter(x=>x.row.words.at(-1)===ROUTES[role]);need(matches.length===1,'nginx_formal_route_duplicate');
    const row=matches[0].row,children=row.children,s=pin.services[role];
    need(same(row.words,['location','^~',ROUTES[role]])&&children&&children.every(x=>!x.children),'nginx_formal_route_unsupported');
    const targets=children.filter(x=>x.words[0]==='set'),proxies=children.filter(x=>x.words[0]==='proxy_pass');
    need(targets.length===1&&same(targets[0].words,['set','$target',s.alias+':'+s.port])&&
      proxies.length===1&&same(proxies[0].words,['proxy_pass','http://$target'])&&
      !children.some(x=>['rewrite','return','try_files','include','proxy_method','proxy_set_body'].includes(x.words[0])), 'nginx_formal_target_drift');
    result[role]=s.id;
  }
  return result;
}

function mounts(container){
  need(Array.isArray(container.Mounts)&&object(container.HostConfig),'mount_inventory_incomplete');
  const out=[],add=m=>{
    need(['bind','volume','tmpfs'].includes(m.type)&&path(m.destination)&&typeof m.rw==='boolean','mount_declaration_invalid');
    if(m.type==='bind')need(path(m.source)&&m.name===null,'bind_declaration_invalid');
    if(m.type==='volume')need(name(m.name)&&(m.source===null||path(m.source)),'volume_declaration_invalid');
    if(m.type==='tmpfs')need(m.source===null&&m.name===null,'tmpfs_declaration_invalid');
    out.push(m);
  };
  for(const m of container.Mounts)add({type:m.Type,source:m.Type==='tmpfs'?null:m.Source,
    destination:m.Destination,name:m.Type==='volume'?m.Name:null,rw:m.RW});
  need(container.HostConfig.Binds===null||Array.isArray(container.HostConfig.Binds),'bind_inventory_invalid');
  for(const bind of container.HostConfig.Binds||[]){
    need(typeof bind==='string'&&bind.length<=2200,'bind_declaration_invalid');
    const parts=bind.split(':');need(parts.length===2||parts.length===3,'bind_declaration_invalid');
    const options=parts[2]?.split(',')||[];
    need(options.every(x=>['ro','rw','z','Z','private','rprivate','shared','rshared','slave','rslave','nocopy'].includes(x))&&
      !(options.includes('ro')&&options.includes('rw')),'bind_options_ambiguous');
    const isBind=parts[0].startsWith('/');
    add({type:isBind?'bind':'volume',source:isBind?parts[0]:null,name:isBind?null:parts[0],
      destination:parts[1],rw:!options.includes('ro')});
  }
  need(container.HostConfig.Mounts===undefined||container.HostConfig.Mounts===null||Array.isArray(container.HostConfig.Mounts),'host_mount_inventory_invalid');
  for(const m of container.HostConfig.Mounts||[]){
    need(m.ReadOnly===undefined||typeof m.ReadOnly==='boolean','mount_readonly_ambiguous');
    add({type:m.Type,source:m.Type==='bind'?m.Source:null,name:m.Type==='volume'?m.Source:null,
      destination:m.Target,rw:m.ReadOnly!==true});
  }
  need(!container.HostConfig.VolumesFrom?.length,'volumes_from_unsupported');
  // A single declaration cannot be both RO and RW through different Docker
  // representations. Do not let a partial inspect mask a configured writer.
  for(const a of out)for(const b of out)if(a.destination===b.destination)
    need(a.type===b.type&&a.name===b.name&&a.rw===b.rw,'mount_declaration_conflict');
  return out;
}
function narrow(container){
  need(hex(container?.Id)&&image(container?.Image)&&/^\/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u.test(container?.Name||'')&&
    object(container.State)&&['running','created','exited','dead','paused','restarting','removing'].includes(container.State.Status)&&
    typeof container.State.Running==='boolean'&&object(container.NetworkSettings?.Networks),'container_inventory_invalid');
  const networks=Object.fromEntries(Object.entries(container.NetworkSettings.Networks).sort().map(([k,v])=>{
    need(name(k)&&object(v)&&(v.NetworkID===''||hex(v.NetworkID))&&
      (v.Aliases===null||Array.isArray(v.Aliases)&&v.Aliases.every(name))&&
      (v.IPAddress===''||privateIp(v.IPAddress)),'network_declaration_invalid');
    return [k,{id:v.NetworkID,aliases:v.Aliases===null?[]:v.Aliases,ip:v.IPAddress}];
  }));
  return {id:container.Id,image:container.Image,name:container.Name,status:container.State.Status,
    running:container.State.Running,pid:container.State.Pid,startedAt:container.State.StartedAt,health:container.State.Health?.Status||null,
    networks,
    mounts:mounts(container),restart:container.HostConfig.RestartPolicy?.Name||'no',
    portBindings:container.HostConfig.PortBindings||{}};
}
function verify(observed,pin,policy,at){
  const {containers,network,config}=observed,byId=new Map(containers.map(x=>[x.id,x]));
  need(byId.size===containers.length&&network.Id===pin.network.id&&network.Name===pin.network.name&&object(network.Containers),'network_inventory_drift');
  need(Object.keys(network.Containers).every(id=>byId.has(id)),'network_member_missing');
  const selected={gateway:pin.gateway,...pin.services},services={};
  for(const [role,p] of Object.entries(selected)){
    const c=byId.get(p.id),endpoint=c?.networks[pin.network.name],member=network.Containers[p.id];
    need(c&&c.name==='/'+p.name&&c.image===p.image&&c.running===true&&c.status==='running','container_identity_or_state_drift');
    need(endpoint?.id===pin.network.id&&member?.Name===p.name&&privateIp(endpoint.ip)&&
      typeof member.IPv4Address==='string'&&member.IPv4Address.startsWith(endpoint.ip+'/')&&
      /^\d{1,2}$/u.test(member.IPv4Address.split('/')[1])&&Number(member.IPv4Address.split('/')[1])<=32,'network_endpoint_drift');
    if(role==='gateway')continue;
    need(timestamp(c.startedAt)&&Date.parse(c.startedAt)<=at&&c.startedAt===policy.containers[role].startedAt,'service_started_at_drift');
    need(c.health==='healthy','service_docker_health_invalid');
    need(Array.isArray(endpoint.aliases)&&endpoint.aliases.includes(p.alias)&&
      same(containers.filter(x=>x.networks[pin.network.name]?.aliases?.includes(p.alias)).map(x=>x.id),[p.id]),'service_alias_drift');
    const data=c.mounts.filter(m=>m.destination==='/app/data');
    need(data.length>0&&data.every(m=>m.rw===true&&m.type===p.dataMount.type&&m.name===p.dataMount.name&&
      (m.source===null&&m.type==='volume'||m.source===p.dataMount.source))&&
      data.some(m=>m.source===p.dataMount.source),'service_data_mount_drift');
    // A protected parent destination would shadow /app/data just as surely
    // as a wrong source. Child mounts make a "full" mount incomplete.
    need(c.mounts.every(m=>!overlap(m.destination,'/app/data')||m.destination==='/app/data'),'service_data_mount_shadowed');
    const physical=data.find(m=>m.source===p.dataMount.source)?.physicalSource;
    need(path(physical),'protected_mount_physical_path_missing');
    const protectedIdentity=data.find(m=>m.source===p.dataMount.source)?.sourceIdentity;
    const holders=containers.filter(x=>x.kernelProtectedRw?.[role]||x.mounts.some(m=>m.rw&&
      (m.type==='volume'&&p.dataMount.type==='volume'&&m.name===p.dataMount.name||
        m.physicalSource&&overlap(m.physicalSource,physical)||
        m.sourceIdentity&&m.sourceIdentity.dev===protectedIdentity?.dev&&m.sourceIdentity.ino===protectedIdentity?.ino)));
    services[role]={id:c.id,image:c.image,name:p.name,alias:p.alias,status:c.status,health:c.health,
      startedAt:c.startedAt,dataMount:{...p.dataMount,rw:true},
      runningRwWriters:holders.filter(x=>x.running).map(x=>x.id).sort(),
      dormantRwContainers:holders.filter(x=>!x.running).map(x=>x.id).sort(),
      dormantAutoRestartRw:holders.filter(x=>!x.running&&x.restart!=='no').map(x=>x.id).sort(),
      checkedAt:new Date(at).toISOString()};
  }
  const gateway=byId.get(pin.gateway.id),configMount=gateway.mounts.filter(m=>m.destination==='/etc/nginx/nginx.conf');
  need(gateway.health===null||gateway.health==='healthy','gateway_docker_health_invalid');
  need(configMount.length>0&&configMount.every(m=>m.type==='bind'&&!m.rw&&m.source===pin.gateway.configSource),'gateway_config_mount_drift');
  const bindingKey=String(pin.gateway.containerPort)+'/tcp',ports=gateway.portBindings[bindingKey];
  need(object(gateway.portBindings)&&Object.entries(gateway.portBindings).every(([key,value])=>{
    const match=/^([1-9]\d{0,4})\/(tcp|udp)$/u.exec(key);
    return match&&port(Number(match[1]))&&(key===bindingKey||value===null||Array.isArray(value)&&value.length===0);
  })&&Array.isArray(ports)&&ports.length===1&&
    keys(ports[0],['HostIp','HostPort'])&&ports[0].HostIp==='127.0.0.1'&&
    ports[0].HostPort===String(pin.gateway.loopbackPort),'gateway_loopback_binding_drift');
  need(digest(config)===pin.gateway.configHash,'gateway_config_hash_drift');
  return {gateway:{id:gateway.id,image:gateway.image,name:pin.gateway.name,status:gateway.status,
    health:null,dockerHealth:gateway.health,routes:nginxRoutes(config,pin),configHash:digest(config),
    listener:{containerPort:pin.gateway.containerPort,serverName:pin.gateway.serverName,
      loopbackPort:Number(ports[0].HostPort)},
    checkedAt:new Date(at).toISOString()},services};
}

/** Returns readTopology({signal}?) with cancellation as its only input. Never
 * accepts a caller-supplied command, URL, container ID or file path. */
export function createDockerTopologyReader({pin,policy,clock=Date.now,execFileImpl=execFile,fetchImpl=globalThis.fetch,realpathImpl=realpath,kernelFsImpl=KERNEL_FS}={}){
  need(typeof clock==='function'&&typeof execFileImpl==='function'&&typeof fetchImpl==='function'&&typeof realpathImpl==='function','transport_invalid');
  need(keys(kernelFsImpl,['readTextBounded','stat','readlink'])&&Object.values(kernelFsImpl).every(x=>typeof x==='function'),'kernel_transport_invalid');
  validate(pin,policy);
  // Capture immutable independently passed inputs; later caller mutation
  // cannot silently repin a transport endpoint or an expected incarnation.
  pin=freeze(JSON.parse(JSON.stringify(pin)));policy=freeze(JSON.parse(JSON.stringify(policy)));
  return async function readTopology(...args){
    need(args.length<=1&&(args.length===0||args[0]===undefined||keys(args[0],[])||
      keys(args[0],['signal'])&&args[0].signal instanceof AbortSignal),'read_topology_arguments_forbidden');
    const external=args[0]?.signal;need(!external?.aborted,'topology_aborted');
    need(execFileImpl!==execFile&&realpathImpl!==realpath&&kernelFsImpl!==KERNEL_FS||process.platform==='linux','release_host_linux_required');
    let previous=-Infinity;const now=()=>{const at=clock();need(Number.isFinite(at)&&at>=previous,'clock_invalid');previous=at;return at;};
    const start=now(),remaining=()=>{need(!external?.aborted,'topology_aborted');
      const left=TOTAL_MS-(now()-start);need(left>0,'topology_deadline');return Math.min(OP_MS,left);};
    const docker=async args=>{
      const allowed=same(args,['ps','--all','--quiet','--no-trunc'])||
        args[0]==='inspect'&&args[1]==='--type'&&args[2]==='container'&&args.length>=4&&args.length<=27&&args.slice(3).every(hex)||
        same(args,['network','inspect',pin.network.id])||same(args,['exec',pin.gateway.id,'nginx','-T']);
      need(allowed,'docker_action_forbidden');
      const timeout=remaining(),controller=new AbortController();let child,timer;
      const abort=()=>{controller.abort();child?.kill?.('SIGKILL');};external?.addEventListener('abort',abort,{once:true});
      try{
        return await new Promise((resolve,reject)=>{
          const fail=code=>reject(new TopologyError(code));
          timer=setTimeout(()=>{controller.abort();child?.kill?.('SIGKILL');fail('docker_read_timeout');},timeout);
          try{child=execFileImpl('/usr/bin/docker',['--host',SOCKET,...args],{
            shell:false,windowsHide:true,encoding:'utf8',timeout,killSignal:'SIGKILL',maxBuffer:MAX_BYTES,signal:controller.signal,
            },(error,stdout)=>{if(error){fail(external?.aborted?'topology_aborted':controller.signal.aborted?'docker_read_timeout':'docker_read_unavailable');return;}
            if(typeof stdout!=='string'||Buffer.byteLength(stdout)>MAX_BYTES){fail('docker_output_invalid');return;}
            resolve(stdout);});}catch{fail('docker_read_unavailable');}
        });
      }finally{
        clearTimeout(timer);
        external?.removeEventListener('abort',abort);
        // Abort may emit an error before the process is reaped. The real
        // transport must not hand control back with a Docker client alive.
        if(execFileImpl===execFile&&child&&child.exitCode===null&&child.signalCode===null)
          await new Promise(resolve=>child.once('close',resolve));
      }
    };
    const json=raw=>{try{return JSON.parse(raw);}catch{throw new TopologyError('docker_json_invalid');}};
    const metadata=async(operation,code)=>{
      const allowance=remaining(),began=now();let result;
      try{result=await operation();}catch(error){if(error instanceof TopologyError)throw error;throw new TopologyError(code);}
      remaining();need(now()-began<=allowance,'kernel_metadata_timeout');return result;
    };
    const text=async(file,max)=>metadata(()=>kernelFsImpl.readTextBounded(file,max),'kernel_metadata_unavailable');
    const kernelMounts=async rows=>{
      const checkedAt=new Date(now()).toISOString();
      const hostRaw=await text('/proc/self/mountinfo',1024*1024),host=mountInfo(hostRaw),sourceStats=new Map();
      const sourceIdentity=async source=>{
        if(sourceStats.has(source))return sourceStats.get(source);
        const actual=statIdentity(await metadata(()=>kernelFsImpl.stat(source,{bigint:true}),'kernel_mount_source_unavailable'));
        const matching=host.filter(x=>x.device===actual.device&&(x.destination==='/'||source===x.destination||source.startsWith(x.destination+'/')))
          .sort((a,b)=>b.destination.length-a.destination.length);
        need(matching.length>0&&!(matching.length>1&&matching[0].destination===matching[1].destination),'kernel_source_mount_ambiguous');
        const h=matching[0],relative=source===h.destination?'':source.slice(h.destination==='/'?1:h.destination.length+1);
        actual.filesystemRoot=((h.root==='/'?'':h.root)+(relative?'/'+relative:''))||'/';
        sourceStats.set(source,actual);return actual;
      };
      const protectedSources={};for(const role of ROLES)protectedSources[role]=await sourceIdentity(pin.services[role].dataMount.source);
      for(const c of rows){
        for(const m of c.mounts)if(m.physicalSource)m.sourceIdentity=await sourceIdentity(m.physicalSource);
        if(!c.running)continue;
        need(Number.isSafeInteger(c.pid)&&c.pid>0&&c.pid<=2147483647,'kernel_pid_invalid');
        const base='/proc/'+c.pid,readProcess=async()=>{
          const startTicks=processStart(await text(base+'/stat',16384),c.pid);
          const namespace=await metadata(()=>kernelFsImpl.readlink(base+'/ns/mnt'),'kernel_namespace_unavailable');
          need(typeof namespace==='string'&&/^mnt:\[\d+\]$/u.test(namespace),'kernel_namespace_invalid');
          const raw=await text(base+'/mountinfo',1024*1024);return {startTicks,namespace,raw};
        };
        const before=await readProcess(),actual=mountInfo(before.raw),mountProofs=[];
        const declared=[...new Map(c.mounts.filter(m=>m.type!=='tmpfs').map(m=>[m.destination,m])).values()];
        for(const m of declared){
          need(m.sourceIdentity,'kernel_mount_source_missing');const candidates=actual.filter(x=>x.destination===m.destination);
          need(candidates.length===1,'kernel_declared_mount_missing_or_shadowed');const observed=candidates[0];
          need(observed.rw===m.rw&&observed.device===m.sourceIdentity.device&&observed.root===m.sourceIdentity.filesystemRoot,'kernel_declared_mount_drift');
          const target=statIdentity(await metadata(()=>kernelFsImpl.stat(base+'/root'+m.destination,{bigint:true}),'kernel_mount_target_unavailable'));
          need(target.dev===m.sourceIdentity.dev&&target.ino===m.sourceIdentity.ino&&target.kind===m.sourceIdentity.kind,'kernel_mount_identity_mismatch');
          mountProofs.push({destination:m.destination,mountId:observed.id,...target,rw:observed.rw});
        }
        c.kernelProtectedRw=Object.fromEntries(ROLES.map(role=>[role,actual.some(x=>x.rw&&
          x.device===protectedSources[role].device&&rootOverlap(x.root,protectedSources[role].filesystemRoot))||
          mountProofs.some(x=>x.rw&&x.dev===protectedSources[role].dev&&x.ino===protectedSources[role].ino)]));
        for(const role of ROLES)if(c.id===pin.services[role].id)
          need(!actual.some(x=>x.destination.startsWith('/app/data/')),'kernel_protected_mount_shadowed');
        const after=await readProcess();need(same(before,after),'kernel_process_or_mount_changed');
        for(const m of declared){
          const source=statIdentity(await metadata(()=>kernelFsImpl.stat(m.physicalSource,{bigint:true}),'kernel_mount_source_unavailable'));
          const target=statIdentity(await metadata(()=>kernelFsImpl.stat(base+'/root'+m.destination,{bigint:true}),'kernel_mount_target_unavailable'));
          need(source.dev===m.sourceIdentity.dev&&source.ino===m.sourceIdentity.ino&&same(source,target),'kernel_mount_identity_changed');
        }
        c.kernelIdentity={pid:c.pid,startTicks:before.startTicks,mountNamespace:before.namespace,
          mountinfoSha256:digest(before.raw),mounts:mountProofs,checkedAt};
      }
      need(hostRaw===await text('/proc/self/mountinfo',1024*1024),'kernel_host_mount_changed');
    };
    const collect=async()=>{
      const ids=(await docker(['ps','--all','--quiet','--no-trunc'])).trim().split(/\s+/u);
      need(ids.length>0&&ids.length<=1024&&ids.every(hex)&&new Set(ids).size===ids.length,'container_ids_invalid');ids.sort();
      const rows=[];
      for(let i=0;i<ids.length;i+=24){const batch=json(await docker(['inspect','--type','container',...ids.slice(i,i+24)]));
        need(Array.isArray(batch),'container_inspect_invalid');rows.push(...batch.map(narrow));}
      need(same(rows.map(x=>x.id).sort(),ids),'inventory_changed_during_inspect');
      // Metadata only: paths originate from actual Docker declarations, not
      // a request parameter, policy-created inventory or arbitrary file read.
      // Resolve independently in both snapshots so symlink retargeting is CAS
      // drift. Native realpath is not cancellable: await its completion, then
      // enforce clock/Abort before any next read or returned evidence.
      const paths=[...new Set(rows.flatMap(c=>c.mounts.map(m=>m.source).filter(Boolean)))].sort();
      need(paths.length<=4096,'mount_path_inventory_oversize');const resolved=new Map();
      for(const source of paths){
        const allowance=remaining(),began=now();let physical;
        try{physical=await realpathImpl(source);}catch{throw new TopologyError('mount_realpath_unavailable');}
        remaining();need(now()-began<=allowance,'mount_realpath_timeout');
        need(path(physical),'mount_realpath_invalid');resolved.set(source,physical);
      }
      const volumes=new Map();
      for(const c of rows)for(const m of c.mounts)if(m.type==='volume'&&m.source){
        const physical=resolved.get(m.source);need(!volumes.has(m.name)||volumes.get(m.name)===physical,'volume_physical_source_conflict');
        volumes.set(m.name,physical);
      }
      for(const c of rows){
        for(const m of c.mounts){if(m.source)m.physicalSource=resolved.get(m.source);
          else if(m.type==='volume')m.physicalSource=volumes.get(m.name)||null;
          need(!(m.type==='volume'&&m.rw&&!m.physicalSource),'volume_physical_path_unavailable');}
        // A running bind retains its old target if a source symlink was
        // retargeted after mount. Current realpath alone cannot establish that
        // historical mount identity; refuse rather than omit a possible RW.
        need(!c.running||c.mounts.every(m=>!m.rw||!m.source||m.physicalSource===m.source),
          'running_rw_source_noncanonical');
        for(const a of c.mounts)for(const b of c.mounts)if(a.destination===b.destination&&a.physicalSource&&b.physicalSource)
          need(a.physicalSource===b.physicalSource,'mount_declaration_conflict');
      }
      await kernelMounts(rows);
      const nets=json(await docker(['network','inspect',pin.network.id]));need(Array.isArray(nets)&&nets.length===1,'network_inspect_invalid');
      const config=await docker(['exec',pin.gateway.id,'nginx','-T']);
      const network=nets[0];
      const observed={containers:rows.sort((a,b)=>a.id.localeCompare(b.id)),network:{Id:network.Id,Name:network.Name,
        Containers:object(network.Containers)?Object.fromEntries(Object.entries(network.Containers).sort().map(([id,m])=>[id,{Name:m.Name,
          IPv4Address:m.IPv4Address,IPv6Address:m.IPv6Address,EndpointID:m.EndpointID}])):null},config};
      return {observed,topology:verify(observed,pin,policy,now())};
    };
    const health=async url=>{
      const timeout=remaining(),controller=new AbortController();let timer,reader;
      const abort=()=>{controller.abort();void reader?.cancel().catch(()=>{});};external?.addEventListener('abort',abort,{once:true});
      const pending=(async()=>{
        const response=await fetchImpl(url,{method:'GET',redirect:'error',signal:controller.signal,
          headers:{accept:'application/json',host:pin.gateway.serverName==='_'?'hub.fandow.com':pin.gateway.serverName}});
        need(response?.status===200&&response.redirected!==true,'health_http_invalid');
        need(response.headers?.get('content-type')?.toLowerCase().includes('application/json'),'health_content_type_invalid');
        need(response.body&&typeof response.body.getReader==='function','health_body_invalid');
        const declared=response.headers.get('content-length');
        need(declared===null||/^\d+$/u.test(declared)&&Number(declared)<=HEALTH_BYTES,'health_body_oversize');
        reader=response.body.getReader();const chunks=[];let length=0;
        while(true){const {done,value}=await reader.read();if(done)break;
          need(value instanceof Uint8Array,'health_body_invalid');length+=value.length;need(length<=HEALTH_BYTES,'health_body_oversize');chunks.push(value);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new TopologyError('health_json_invalid');}
        need(object(body)&&body.ok===true,'health_service_unhealthy');return body;
      })();
      try{return await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>{
        controller.abort();void reader?.cancel().catch(()=>{});reject(new TopologyError('health_read_timeout'));},timeout);})]);}
      catch(error){controller.abort();if(external?.aborted)throw new TopologyError('topology_aborted');
        if(error instanceof TopologyError)throw error;throw new TopologyError('health_read_unavailable');}
      finally{clearTimeout(timer);external?.removeEventListener('abort',abort);if(reader)await reader.cancel().catch(()=>{});
        // Native fetch respects AbortSignal; wait for it to settle before
        // returning a failure rather than leave reads alive behind a race.
        if(fetchImpl===globalThis.fetch&&controller.signal.aborted)await pending.catch(()=>{});}
    };
    const checkHealth=async observed=>{
      const proofs=[];let hubIdentity;
      for(const role of ROLES){
        const s=pin.services[role],ip=observed.containers.find(x=>x.id===s.id).networks[pin.network.name].ip;
        let directHash;
        for(const url of [`http://${ip}:${s.port}/health`,`http://127.0.0.1:${pin.gateway.loopbackPort}${ROUTES[role]}health`]){
          const body=await health(url);
          const responseHash=digest(JSON.stringify(body));
          if(!directHash)directHash=responseHash;else need(responseHash===directHash,'gateway_service_health_mismatch');
          if(role==='hub'){
            need(identity(body.release)&&identity(body.liveNextDayInstance)&&body.release===policy.containers.hub.release&&
              body.liveNextDayInstance===policy.containers.hub.liveNextDayInstance,'hub_health_instance_drift');
            hubIdentity={release:body.release,liveNextDayInstance:body.liveNextDayInstance};
          }
          proofs.push({role,via:url.includes('127.0.0.1')?'gateway':'service',checkedAt:new Date(now()).toISOString()});
        }
      }
      return {proofs,hubIdentity};
    };
    const first=await collect(),firstHealth=await checkHealth(first.observed);
    // Last inventory is the final read, after both health phases. Otherwise
    // a restart/mount change during the last probes would escape the CAS.
    const lastHealth=await checkHealth(first.observed),last=await collect();
    const fingerprint=x=>digest(JSON.stringify({...x,config:digest(x.config),containers:x.containers.map(c=>
      ({...c,...(c.kernelIdentity?{kernelIdentity:{...c.kernelIdentity,checkedAt:undefined}}:{})}))}));
    need(fingerprint(first.observed)===fingerprint(last.observed)&&same(firstHealth.hubIdentity,lastHealth.hubIdentity),'topology_changed_during_read');
    const finished=now();need(!external?.aborted,'topology_aborted');need(finished-start<=TOTAL_MS,'topology_deadline');
    for(const role of ROLES){
      const service=last.topology.services[role];service.topologyCheckedAt=service.checkedAt;
      service.kernelMountIdentity=last.observed.containers.find(c=>c.id===service.id).kernelIdentity;
      service.healthProbes=lastHealth.proofs.filter(p=>p.role===role);
      service.checkedAt=new Date(Math.min(Date.parse(service.checkedAt),Date.parse(service.kernelMountIdentity.checkedAt),
        ...service.healthProbes.map(p=>Date.parse(p.checkedAt)))).toISOString();
    }
    Object.assign(last.topology.services.hub,lastHealth.hubIdentity);
    last.topology.gateway.topologyCheckedAt=last.topology.gateway.checkedAt;
    Object.assign(last.topology.gateway,{health:'healthy',healthProvenBy:'formal_route_http',
      healthProbes:lastHealth.proofs.filter(p=>p.via==='gateway'),
      checkedAt:new Date(Math.min(Date.parse(last.topology.gateway.checkedAt),
        ...lastHealth.proofs.map(p=>Date.parse(p.checkedAt)))).toISOString()});
    return {...last.topology,readOnly:true,unsafeWriters:ROLES.some(role=>
      !same(last.topology.services[role].runningRwWriters,[pin.services[role].id])||last.topology.services[role].dormantRwContainers.length>0),
      topologySha256:fingerprint(last.observed),observedAt:new Date(finished).toISOString()};
  };
}
