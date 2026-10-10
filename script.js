// DKL customer inquiry board client (production requires Apps Script deployment).
const CONFIG = { apiUrl: 'https://script.google.com/macros/s/AKfycbwKjBOCrtrxnJyYz7ILXfzWTbSmNfcaI4bdukRpvnIEdpU7XKb90y1AxepzJ7uTiTV6/exec' }; // DKL 고객문의 웹 앱 배포 URL
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
// Public board uses the Apps Script HTMLService iframe reply.
let boardToken=null, boardFrame=null, boardTimer=null;
function fetchPublicRows(){
 if(!endpoint){boardStatus.textContent='게시판 서버 연결 전입니다.';return;}
 if(boardFrame){boardFrame.remove();boardFrame=null;}
 if(boardTimer){clearTimeout(boardTimer);boardTimer=null;}
 const token='board_'+Date.now()+'_'+Math.random().toString(36).slice(2);
 boardToken=token;boardStatus.textContent='게시판 목록을 불러오는 중입니다…';
 const frame=document.createElement('iframe');
 frame.name='dklBoardReceiver';frame.style.display='none';frame.title='공개 상담 목록 확인';
 boardFrame=frame;document.body.append(frame);
 // Google Apps Script GET response has been returning HTTP 404.
 // Reuse the already-working POST/HtmlService message transport.
 const request=document.createElement('form');
 request.method='POST';request.action=endpoint;request.target=frame.name;request.style.display='none';
 for(const [name,value] of Object.entries({mode:'public',token})){
   const input=document.createElement('input');input.name=name;input.value=value;request.append(input);
 }
 document.body.append(request);request.submit();
 setTimeout(()=>request.remove(),30000);
 boardTimer=setTimeout(()=>{
   if(boardToken!==token)return;
   boardToken=null;frame.remove();if(boardFrame===frame)boardFrame=null;
   boardStatus.textContent='게시판을 불러오지 못했습니다.';
 },30000);
}
$('boardRefresh')?.addEventListener('click',fetchPublicRows);
window.addEventListener('message',event=>{
 if(!boardToken||!/^https:\/\/([a-z0-9-]+\.)*googleusercontent\.com$/.test(event.origin))return;
 const data=event.data;
 if(!data||data.type!=='dkl-board-response'||data.token!==boardToken)return;
 boardToken=null;if(boardTimer){clearTimeout(boardTimer);boardTimer=null;}
 if(boardFrame){boardFrame.remove();boardFrame=null;}
 if(!data.ok){boardStatus.textContent='공개 게시판을 불러오지 못했습니다.';return;}
 renderRows(Array.isArray(data.items)?data.items:[]);
 boardStatus.textContent='관리자가 공개 승인한 문의만 표시됩니다.';
});
fetchPublicRows();
function makeIframe(){let iframe=$('dklInquiryReceiver');if(!iframe){iframe=document.createElement('iframe');iframe.name='dklInquiryReceiver';iframe.id='dklInquiryReceiver';iframe.style.display='none';iframe.title='상담 접수 결과';document.body.append(iframe);}return iframe;}
let waitingToken=null;
window.addEventListener('message',event=>{
 // Accept authenticated Apps Script HTML responses hosted on Google domains; correlate by per-submission token.
 if(!waitingToken)return;
 // Diagnostic: log response origin and message type, never customer data or form fields.
 if(/^https:\/\/([a-z0-9-]+\.)*(googleusercontent\.com|google\.com)$/.test(event.origin)) console.info('[DKL receipt] Message received from Google:',event.origin,'type:',typeof event.data==='object'?event.data?.type:'text');
 const trustedOrigin=/^https:\/\/([a-z0-9-]+\.)*(googleusercontent\.com|google\.com)$/.test(event.origin);
 if(!trustedOrigin)return;
 let data=event.data;
 if(typeof data==='string'){try{data=JSON.parse(data);}catch{return;}}
 if(!data || data.type!=='dkl-inquiry-response'||data.token!==waitingToken)return;
 waitingToken=null;clearTimeout(form._timer);submit.disabled=false;
 if(data.ok){
   form.reset();
   const receipt=$('consultSuccess');
   $('consultReceiptNo').textContent=data.number||'접수번호 확인 필요';
   $('consultEmailNotice').textContent=data.customerEmailSent?'입력하신 이메일로 접수 확인 메일을 발송했습니다.':'접수는 완료되었지만 이메일 발송 여부는 확인되지 않았습니다. 필요한 경우 전화로 문의해 주세요.';
   form.hidden=true;
   receipt.hidden=false;
   receipt.scrollIntoView({behavior:'smooth',block:'center'});
 }
 else status.textContent='접수 실패: '+(data.message||'잠시 후 다시 시도해 주세요.');
});
// Explain HTML form validation failures, which block the submit event itself.
form?.addEventListener('invalid', e=>{
 const field=e.target;
 if(!field || !field.matches('input,select,textarea'))return;
 const label=field.closest('label');
 const fieldName=label?.textContent?.replace('*','').trim().slice(0,35)||'필수 입력 항목';
 status.textContent=field.id==='privacy'?'개인정보 수집 및 이용 동의에 체크해 주세요.':field.id==='email'?'올바른 이메일 주소를 입력해 주세요.':fieldName+' 항목을 확인해 주세요.';
},true);
submit?.addEventListener('click',()=>{
 if(submit.disabled)return;
 if(!form.checkValidity()) {
   const invalid=form.querySelector(':invalid');
   if(invalid?.id==='privacy')status.textContent='개인정보 수집 및 이용 동의에 체크해 주세요.';
   else status.textContent='필수 항목을 모두 입력하고 이메일 주소를 확인해 주세요.';
 }
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
 document.body.append(payload);
 // Leave the submitting form attached until the hidden iframe has navigated.
 // Removing it synchronously can interrupt the response navigation in browsers.
 payload.submit();
 setTimeout(()=>payload.remove(),30000);
 form._timer=setTimeout(()=>{if(waitingToken===token){waitingToken=null;submit.disabled=false;status.textContent='접수 완료 화면으로 연결되지 않았습니다. 실제 접수되었을 수 있으니 접수 확인 이메일과 접수번호를 먼저 확인해 주세요. 중복 접수 방지를 위해 다시 제출하지 마세요.';}},30000);
});
$('consultAgain')?.addEventListener('click',()=>{
 $('consultSuccess').hidden=true;
 form.hidden=false;
 status.textContent='';
 form.reset();
 form.scrollIntoView({behavior:'smooth',block:'start'});
});
$('copyAddress')?.addEventListener('click',async()=>{const addr='경상남도 김해시 인제로 143번지, 2층';try{await navigator.clipboard.writeText(addr);$('addressStatus').textContent='주소가 복사되었습니다.';}catch{$('addressStatus').textContent=addr;}});
