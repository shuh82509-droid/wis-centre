import {readFileSync} from 'node:fs';
import {SparkLibraryStore,SparkError,validateSparkBatch,importSparkBatch} from './spark-library.mjs';

async function main(){
  const args=process.argv.slice(2);let root,file,validateOnly=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--root')root=args[++i];
    else if(args[i]==='--file')file=args[++i];
    else if(args[i]==='--validate-only')validateOnly=true;
    else throw new SparkError(400,'不支持的参数；用法：node spark-import.mjs --root /app/data/spark-library --file /tmp/batch.json [--validate-only]');
  }
  if(!root||!file)throw new SparkError(400,'必须提供 --root 和 --file');
  const batch=JSON.parse(readFileSync(file,'utf8')),store=new SparkLibraryStore(root);
  if(validateOnly){process.stdout.write(JSON.stringify(validateSparkBatch(batch,store))+'\n');return;}
  // Short bounded retries are only for an unacquired file lock: no commit occurred.
  for(let n=0;;n++){
    try{const result=importSparkBatch(store,batch);process.stdout.write(JSON.stringify(result)+'\n');return;}
    catch(e){if(e.code!=='SPARK_STORE_BUSY'||n>=39)throw e;await new Promise(r=>setTimeout(r,50+n*5));}
  }
}
try{await main();}catch(e){
  process.stderr.write(JSON.stringify({ok:false,status:e.status||400,code:e.code||'SPARK_IMPORT_FAILED',detail:e instanceof SparkError?e.message:'导入未完成，请检查 JSON 文件；现有星火库未被清空'})+'\n');
  process.exitCode=1;
}

