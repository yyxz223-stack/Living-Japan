import { startLivingJapan } from '../src/app.js';
const listeners=new Map(),macros=new Map();
const context={chat:[],extensionSettings:{},getRequestHeaders:()=>({'Content-Type':'application/json'}),event_types:Object.fromEntries(['GENERATION_AFTER_COMMANDS','GENERATION_ENDED','GENERATION_STOPPED','CHAT_CHANGED','APP_READY'].map(x=>[x,x])),eventSource:{on(name,fn){if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeListener(name,fn){listeners.get(name)?.delete(fn);}},registerMacro(name,fn){macros.set(name,fn);},unregisterMacro(name){macros.delete(name);},saveSettingsDebounced(){}};
globalThis.SillyTavern={getContext:()=>context};
globalThis.LivingJapanReady=startLivingJapan({baseUrl:new URL('../',import.meta.url),context});
try{
 const bridge=await globalThis.LivingJapanReady;
 document.getElementById('previewStatus').textContent=`隔离预览已就绪，初始资料加载 ${bridge.metrics.startupMs} ms。`;
 await bridge.open();
 document.getElementById('openApp').onclick=()=>bridge.open();
 for(const [id,layout] of [['layoutDesktop','desktop'],['layoutPortrait','portrait'],['layoutMobile','mobile']])document.getElementById(id).onclick=()=>bridge.setLayout(layout);
 document.getElementById('simulate').onclick=async()=>{context.chat=[{is_user:true,mes:document.getElementById('send_textarea').value,is_system:false}];for(const fn of listeners.get('GENERATION_AFTER_COMMANDS')||[])await fn('normal',{},false);const fn=macros.get(bridge.engine.data.macroName)||macros.get('livingjapan');const prompt=typeof fn==='function'?fn():'';document.getElementById('outputCount').textContent=`隔离宏展开 ${prompt.length} 字符；没有发送模型`;for(const cb of listeners.get('GENERATION_ENDED')||[])await cb();};
}catch(error){document.getElementById('previewStatus').textContent=`启动失败：${error.message}`;console.error(error);}
