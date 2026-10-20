// Counts are shared by the dedicated server, never calculated from this browser's history.
(() => {
  const counter = document.getElementById('visitorCounter');
  const today = document.getElementById('visitorToday');
  const total = document.getElementById('visitorTotal');
  if (!counter || !today || !total) return;

  const unavailable = () => {
    counter.title = '현재 방문자 수를 확인할 수 없습니다.';
    for (const element of [today, total]) element.setAttribute('aria-label', '확인 불가');
  };
  let endpoint;
  try {
    endpoint = new URL(typeof CONFIG === 'undefined' ? '' : CONFIG.visitorApiUrl);
    // Protect the inquiry backend from accidentally receiving visitor submissions.
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(endpoint.href) ||
        endpoint.href === CONFIG.apiUrl) throw new Error('Invalid counter endpoint');
  } catch {
    unavailable();
    return;
  }

  let visitorId;
  let token;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  try {
    visitorId = localStorage.getItem('dkl.visitorId.v1');
    if (!uuid.test(visitorId || '')) {
      visitorId = crypto.randomUUID();
      localStorage.setItem('dkl.visitorId.v1', visitorId);
    }
    token = crypto.randomUUID();
  } catch {
    // Counting with a fresh ID on every reload would inflate the shared total.
    unavailable();
    return;
  }

  const frame = document.createElement('iframe');
  frame.name = 'dklVisitor_' + token;
  frame.title = '방문자 수 확인';
  frame.hidden = true;
  const request = document.createElement('form');
  request.method = 'POST';
  request.action = endpoint.href;
  request.target = frame.name;
  request.hidden = true;
  for (const [name, value] of Object.entries({visitorId, token, origin: location.origin})) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    request.append(input);
  }

  const cleanup = () => {
    clearTimeout(timer);
    window.removeEventListener('message', receive);
    request.remove();
    frame.remove();
  };
  const receive = (event) => {
    let origin;
    try { origin = new URL(event.origin); } catch { return; }
    if (origin.protocol !== 'https:' ||
        !(origin.hostname === 'script.google.com' || origin.hostname === 'googleusercontent.com' ||
          origin.hostname.endsWith('.googleusercontent.com'))) return;
    const data = event.data;
    if (!data || data.type !== 'dkl-visitors-response' || data.token !== token) return;
    cleanup();
    if (data.ok !== true || !Number.isSafeInteger(data.today) || !Number.isSafeInteger(data.total) ||
        data.today < 0 || data.total < data.today || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      unavailable();
      return;
    }
    today.textContent = data.today.toLocaleString('ko-KR');
    total.textContent = data.total.toLocaleString('ko-KR');
    today.removeAttribute('aria-label');
    total.removeAttribute('aria-label');
    counter.title = data.date + ' 한국 시간 기준 · 같은 브라우저는 하루 한 번 집계 · 총방문자는 집계 시작 이후 일별 방문자의 누적 합계입니다.';
  };
  const timer = setTimeout(() => { cleanup(); unavailable(); }, 30000);
  window.addEventListener('message', receive);
  document.body.append(frame, request);
  try { request.submit(); } catch { cleanup(); unavailable(); }
})();
