export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const button = (text, action, extra = '') => `<button type="button" class="lj-button" data-action="${action}" ${extra}>${esc(text)}</button>`;
export const switchButton = (on, label, action, extra = '') => `<button type="button" class="lj-switch" aria-pressed="${on}" aria-label="${esc(label)}" title="${esc(label)}" data-action="${action}" ${extra}></button>`;
export function setText(selector, text) { $$(selector).forEach(node => { node.textContent = text; }); }
export function ask({ title, message, choices, fields = [] }) {
  return new Promise(resolve => {
    const dialog=document.createElement('dialog');dialog.className='lj-dialog';
    dialog.innerHTML=`<h3>${esc(title)}</h3><p>${esc(message)}</p>${fields.map(field=>`<label>${esc(field.label)}${field.options?`<select name="${esc(field.id)}">${field.options.map(x=>`<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('')}</select>`:`<input name="${esc(field.id)}" value="${esc(field.value||'')}" autocomplete="off">`}</label>`).join('')}<div class="lj-dialog-actions">${choices.map(c=>`<button type="button" class="lj-button ${c.primary?'primary':''}" data-choice="${esc(c.id)}">${esc(c.label)}</button>`).join('')}</div>`;
    const finish=id=>{const values=Object.fromEntries($$('input,select',dialog).map(n=>[n.name,n.value]));dialog.close();dialog.remove();resolve(fields.length?{id,values}:id);};
    dialog.addEventListener('click',event=>{const target=event.target.closest('[data-choice]');if(target)finish(target.dataset.choice);});
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish('cancel');});document.body.append(dialog);dialog.showModal();
  });
}
export function status(message, type='') {
  let node=$('#ljRuntimeStatus');if(!node){node=document.createElement('div');node.id='ljRuntimeStatus';node.setAttribute('role','status');Object.assign(node.style,{position:'fixed',bottom:'10px',left:'50%',transform:'translateX(-50%)',zIndex:100000,maxWidth:'85%',padding:'8px 12px',borderRadius:'4px',background:'#23362fee',color:'white',fontSize:'13px',pointerEvents:'none'});document.body.append(node);}
  node.textContent=message;node.hidden=false;clearTimeout(status.timer);status.timer=setTimeout(()=>{node.hidden=true;},type==='error'?7000:3500);
}
export function applyTheme(theme='auto') { document.body.dataset.theme=theme==='auto'?(matchMedia('(prefers-color-scheme:dark)').matches?'night':'day'):theme; }
