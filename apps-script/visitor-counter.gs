// Deploy this file as a separate Apps Script project, never the inquiry project.
const VISITOR_ORIGINS = ['https://dkleng.co.kr', 'https://www.dkleng.co.kr'];
const VISITOR_STORE_KEY = 'DKL_VISITOR_SPREADSHEET_ID';
const VISITOR_SHEET = 'Visits';
const VISITOR_HEADERS = ['date_kst', 'visitor_hash'];
const VISITOR_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Run once in the Apps Script editor and authorize spreadsheet access.
// Re-running setup preserves the existing ledger and its counts.
function setupVisitorCounter() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const properties = PropertiesService.getScriptProperties();
    let id = properties.getProperty(VISITOR_STORE_KEY);
    let book;
    if (id) {
      book = SpreadsheetApp.openById(id);
      visitorSheet_(book);
    } else {
      book = SpreadsheetApp.create('DKL 방문자 집계');
      book.setSpreadsheetTimeZone('Asia/Seoul');
      const sheet = book.getSheets()[0];
      sheet.setName(VISITOR_SHEET);
      sheet.getRange('A:B').setNumberFormat('@');
      sheet.getRange(1, 1, 1, 2).setValues([VISITOR_HEADERS]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 2).protect()
        .setDescription('방문자 집계 헤더: 수정하거나 삭제하지 마세요.')
        .setWarningOnly(true);
      SpreadsheetApp.flush();
      properties.setProperty(VISITOR_STORE_KEY, book.getId());
    }
    Logger.log(book.getUrl());
    return book.getUrl();
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return HtmlService.createHtmlOutput('DKL visitor counter: POST only.');
}

function doPost(event) {
  const parameters = event && event.parameter || {};
  const origin = String(parameters.origin || '');
  // Never reply to arbitrary origins and never modify the ledger for invalid input.
  if (VISITOR_ORIGINS.indexOf(origin) === -1) {
    return HtmlService.createHtmlOutput('');
  }
  const token = String(parameters.token || '');
  const visitorId = String(parameters.visitorId || '').toLowerCase();
  const response = {
    type: 'dkl-visitors-response',
    token: VISITOR_UUID.test(token) ? token : '',
    ok: false
  };
  if (VISITOR_UUID.test(token) && VISITOR_UUID.test(visitorId)) {
    try {
      const counts = countVisitor_(visitorId);
      response.ok = true;
      response.today = counts.today;
      response.total = counts.total;
      response.date = counts.date;
    } catch (error) {
      // Do not expose spreadsheet IDs, authorization errors, or visitor IDs.
      console.error('Visitor counter unavailable.');
    }
  }
  return visitorReply_(response, origin);
}

function visitorSheet_(book) {
  const sheet = book.getSheetByName(VISITOR_SHEET);
  if (!sheet || sheet.getLastRow() < 1) throw new Error('Missing visitor ledger.');
  const headers = sheet.getRange(1, 1, 1, 2).getValues()[0];
  if (headers[0] !== VISITOR_HEADERS[0] || headers[1] !== VISITOR_HEADERS[1]) {
    throw new Error('Unexpected visitor ledger headers.');
  }
  return sheet;
}

function countVisitor_(visitorId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const id = PropertiesService.getScriptProperties().getProperty(VISITOR_STORE_KEY);
    if (!id) throw new Error('Run setupVisitorCounter first.');
    const sheet = visitorSheet_(SpreadsheetApp.openById(id));
    const date = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
    const hash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, visitorId)
      .map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); })
      .join('');
    const size = sheet.getLastRow() - 1;
    const rows = size ? sheet.getRange(2, 1, size, 2).getValues() : [];
    let today = 0;
    let alreadyCounted = false;
    rows.forEach(function (row) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row[0]) || !/^[0-9a-f]{64}$/.test(row[1])) {
        throw new Error('Invalid visitor ledger row.');
      }
      if (row[0] === date) {
        today += 1;
        if (row[1] === hash) alreadyCounted = true;
      }
    });
    let total = rows.length;
    if (!alreadyCounted) {
      const nextRow = sheet.getLastRow() + 1;
      if (nextRow > sheet.getMaxRows()) {
        sheet.insertRowsAfter(sheet.getMaxRows(), 1000);
      }
      // Set text format on the actual target cells before writing. Otherwise
      // Sheets may parse YYYY-MM-DD as a Date object on the next request.
      sheet.getRange(nextRow, 1, 1, 2).setNumberFormat('@').setValues([[date, hash]]);
      SpreadsheetApp.flush();
      today += 1;
      total += 1;
    }
    if (!Number.isSafeInteger(today) || !Number.isSafeInteger(total)) {
      throw new Error('Visitor count exceeds supported range.');
    }
    return { today: today, total: total, date: date };
  } finally {
    lock.releaseLock();
  }
}

function visitorJson_(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, function (character) {
    return '\\u' + ('0000' + character.charCodeAt(0).toString(16)).slice(-4);
  });
}

function visitorReply_(response, origin) {
  return HtmlService.createHtmlOutput('<!doctype html><meta charset="utf-8"><script>' +
    'window.top.postMessage(' + visitorJson_(response) + ',' + visitorJson_(origin) + ');' +
    '</script>').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
