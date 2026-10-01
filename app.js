const $=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"]/g,c=>'&#'+c.charCodeAt(0)+';');
const P={home:'<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',find:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',key:'<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',copy:'<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',dl:'<path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16"/>',bolt:'<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'};
const svg=n=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>`;
const here=document.body.dataset.p;
document.body.insertAdjacentHTML('beforeend','<nav class="dock">'+[['home','home','/','Home'],['finder','find','/finder','Finder'],['keys','key','/keys','Key']].map(([p,i,h,t])=>`<a href="${h}"${p===here?' class="on"':''}>${svg(i)}<span>${t}</span></a>`).join('')+'</nav>');
document.querySelectorAll('[data-i]').forEach(e=>e.innerHTML=svg(e.dataset.i));
const cp=(b,t)=>{navigator.clipboard.writeText(t);const s=b.querySelector('span');if(!s)return;const o=s.textContent;s.textContent='Copied';setTimeout(()=>s.textContent=o,1400)};
async function mk(){const j=await(await fetch('/keygen',{method:'POST'})).json();if(!j.key)throw new Error(j.error);localStorage.pk=j.key;return j.key}
const key=async()=>localStorage.pk||mk();
const cu=u=>encodeURI(u||'').replace(/'/g,'%27').replace(/\(/g,'%28').replace(/\)/g,'%29');
const f=$('#sf');
if(f)f.onsubmit=async e=>{e.preventDefault();const o=$('#out');o.innerHTML='<div class="sk"></div>'.repeat(3);
try{const k=await key(),r=await fetch('/search?q='+encodeURIComponent($('#q').value)+'&apikey='+k);
if(r.status===401){localStorage.removeItem('pk');return f.onsubmit(e)}
const j=await r.json();if(!j.status)throw new Error(j.error);
o.innerHTML=j.results.map(v=>`<div class="card res"><div class="cv" style="background-image:url('${cu(v.cover)}')"></div><div><b>${esc(v.title)}</b><small>@${esc(v.username)} · ${v.plays.toLocaleString()} plays</small></div><a class="btn sm" download="${v.id}.mp4" href="/download?apikey=${k}&url=${encodeURIComponent(v.url)}">${svg('dl')}Get</a></div>`).join('')||'<div class="card">No results.</div>'}
catch(x){o.innerHTML='<div class="card">'+esc(x.message)+'</div>'}};
const kb=$('#key');
if(kb){let cmd='';const show=k=>{kb.textContent=k;cmd=`curl "${location.origin}/video?q=ronaldo edit" -H "x-api-key: ${k}" -o clip.mp4`;$('#ex').textContent=cmd};
key().then(show).catch(x=>kb.textContent=x.message);
$('#cp').onclick=()=>cp($('#cp'),kb.textContent);$('#fab').onclick=()=>navigator.clipboard.writeText(kb.textContent);
$('#cx').onclick=()=>cp($('#cx'),cmd);$('#nw').onclick=()=>mk().then(show)}
