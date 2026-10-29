import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const user=path.join(root,'.preview-user');
const port=Number(process.env.LJ_PREVIEW_PORT||7129);
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.gz':'application/gzip','.svg':'image/svg+xml','.png':'image/png'};
await fs.mkdir(user,{recursive:true});
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  if(req.method==='POST'&&url.pathname==='/api/files/upload'){
   let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>32*1024*1024)throw Error('预览文件超过32MiB');chunks.push(chunk);}const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   if(typeof input.name!=='string'||!/^living-japan[\w.-]*\.json$/.test(input.name))throw Error('无效的隔离文件名');
   const target=path.join(user,input.name),temporary=target+'.tmp';await fs.writeFile(temporary,Buffer.from(input.data,'base64'));await fs.rename(temporary,target);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({path:`user/files/${input.name}`}));return;
  }
  if(req.method==='POST'&&url.pathname.startsWith('/api/extensions/')){res.writeHead(409,{'Content-Type':'text/plain; charset=utf-8'});res.end('隔离预览不执行真实酒馆扩展更新');return;}
  const relative=decodeURIComponent(url.pathname).replace(/^\/+/, '')||'preview.html';
  const target=relative.startsWith('user/files/')?path.join(user,path.basename(relative)):path.resolve(root,relative);
  if(!target.startsWith(root+path.sep)||relative.split('/').some(p=>p==='.git'||p==='.preview-user'||p==='.local')){res.writeHead(403);res.end();return;}
  const content=await fs.readFile(target);res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(content);
 }catch(error){res.writeHead(error.code==='ENOENT'?404:400,{'Content-Type':'text/plain; charset=utf-8'});res.end(error.code==='ENOENT'?'Not found':error.message);}
});
server.listen(port,'127.0.0.1',()=>console.log(`Living Japan preview: http://127.0.0.1:${port}/preview.html`));
