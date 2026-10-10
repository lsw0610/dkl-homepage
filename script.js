// DKL customer inquiry board client (production requires Apps Script deployment).
const CONFIG = { apiUrl: 'https://script.google.com/macros/s/AKfycbyrcNL6ONnMBGCRhQ4jj4m43hF0qIPwDxIeYAlxiMjRBz8T_vMX-Il11KxLZnGdJ2jj/exec' }; // DKL 고객문의 웹 앱 배포 URL
const $ = (id) => document.getElementById(id);
const toggle = $('menuToggle');
const nav = $('nav');
toggle?.addEventListener('click', () => { const open = nav.classList.toggle('open'); toggle.setAttribute('aria-expanded', String(open)); toggle.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기'); });
nav?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {nav.classList.remove('open');toggle.setAttribute('aria-expanded','false');}));
$('year').textContent = new Date().getFullYear();
const endpoint = CONFIG.apiUrl.trim();
const form = $('consultForm');
const submit = form?.querySelector('button[type="submit"]');
const status = $('formStatus');
const boardStatus = $('boardStatus');
const rows = $('inquiryRows');
function textCell(tr, value, className) { const td=document.createElement('td');td.textContent=String(value||'');if(className)td.className=className;tr.append(td); }
function renderRows(items) {
  rows.replaceChildren();
  if (!items.length) {const tr=document.createElement('tr');const td=document.createElement('td');td.colSpan=4;td.className='empty-row';td.textContent='공개 승인된 상담 내역이 없습니다.';tr.append(td);rows.append(tr);return;}
  items.forEach(item=>{const tr=document.createElement('tr');textCell(tr,item.number);textCell(tr,item.title,'board-title');textCell(tr,item.date);textCell(tr,item.status,'board-status-cell');rows.append(tr);});
}
// JSONP is used only for PUBLIC redacted summaries; the endpoint never returns private fields.
function fetchPublicRows(){
 if(!endpoint){boardStatus.textContent='게시판 서버 연결 전입니다. 설정을 완료하면 실제 문의가 표시됩니다.';return;}
 const callbackName='dklBoardCallback_'+Date.now()+'_'+Math.floor(Math.random()*10000);
 const script=document.createElement('script');let resolved=false;
 const cleanup=()=>{resolved=true;delete window[callbackName];script.remove();clearTimeout(timer);};
 const timer=setTimeout(()=>{if(!resolved){cleanup();boardStatus.textContent='현재 게시판을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.';}},12000);
 window[callbackName]=(payload)=>{cleanup();if(!payload || !payload.ok){boardStatus.textContent='게시판을 불러오지 못했습니다.';return;}renderRows(Array.isArray(payload.items)?payload.items:[]);boardStatus.textContent='승인된 문의만 표시됩니다.';};
 script.onerror=()=>{cleanup();boardStatus.textContent='게시판 연결 오류가 발생했습니다.';};
 script.src=endpoint+'?mode=public&callback='+encodeURIComponent(callbackName)+'&t='+Date.now();document.head.append(script);
}
$('boardRefresh')?.addEventListener('click',fetchPublicRows);
fetchPublicRows();
function makeIframe(){let iframe=$('dklInquiryReceiver');if(!iframe){iframe=document.createElement('iframe');iframe.name='dklInquiryReceiver';iframe.id='dklInquiryReceiver';iframe.style.display='none';iframe.title='상담 접수 결과';document.body.append(iframe);}return iframe;}
let waitingToken=null;
window.addEventListener('message',event=>{
 // Google Apps Script serves HtmlService replies from googleusercontent.com.
 if(!waitingToken || !/^https:\/\/([a-z0-9-]+\.)*googleusercontent\.com$/.test(event.origin))return;
 const data=event.data;if(!data || data.type!=='dkl-inquiry-response'||data.token!==waitingToken)return;
 waitingToken=null;clearTimeout(form._timer);submit.disabled=false;
 if(data.ok){status.textContent='상담 접수가 완료되었습니다. 접수번호: '+data.number+'. 담당자가 확인 후 답변이나 연락을 드리겠습니다. '+(data.customerEmailSent?'입력하신 이메일로 접수 확인 메일을 발송했습니다.':'접수 확인 메일의 발송 여부를 확인하지 못했습니다. 필요한 경우 전화로 문의해 주세요.');form.reset();fetchPublicRows();}
 else status.textContent='접수 실패: '+(data.message||'잠시 후 다시 시도해 주세요.');
});
form?.addEventListener('submit', e=>{
 e.preventDefault();if(!form.reportValidity())return;
 if(!endpoint){status.textContent='온라인 접수 시스템 연결 전입니다. 전화 055-321-4644로 문의해 주세요.';return;}
 if($('botTrap').value)return;
 if(waitingToken)return;
 const token=String(Date.now())+Math.random().toString(36).slice(2);
 waitingToken=token;submit.disabled=true;status.textContent='접수 내용을 전송하고 있습니다…';
 const payload=document.createElement('form');payload.method='POST';payload.action=endpoint;payload.target=makeIframe().name;payload.style.display='none';
 const fields=['subject','region','facility','request','location','name','phone','email','organization','calltime','message'];
 fields.forEach(key=>{const inp=document.createElement('input');inp.name=key;inp.value=$(key).value;payload.append(inp);});
 for(const [key,value] of Object.entries({token,consent:'yes',website:$('botTrap').value})){const inp=document.createElement('input');inp.name=key;inp.value=value;payload.append(inp);}
 document.body.append(payload);payload.submit();payload.remove();
 form._timer=setTimeout(()=>{if(waitingToken===token){waitingToken=null;submit.disabled=false;status.textContent='접수 결과를 확인하지 못했습니다. 중복 접수 방지를 위해 먼저 회사에 확인해 주세요.';}},20000);
});
$('copyAddress')?.addEventListener('click',async()=>{const addr='경상남도 김해시 인제로 143번지, 2층';try{await navigator.clipboard.writeText(addr);$('addressStatus').textContent='주소가 복사되었습니다.';}catch{$('addressStatus').textContent=addr;}});
