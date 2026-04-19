/*
  Google Apps Script Web App receiver for Airtable inbound leads.

  Setup:
  1. Open the existing Google Sheet.
  2. Extensions -> Apps Script.
  3. Paste this file.
  4. In Project Settings -> Script Properties, add:
     PIPELINE_WEBHOOK_TOKEN = <long random token>
  5. Deploy -> New deployment -> Web app
     Execute as: Me
     Who has access: Anyone with the link
  6. Use the deployed URL with ?token=<PIPELINE_WEBHOOK_TOKEN> in Airtable automation.

  This script:
  - inserts a new Pipeline Ops row for a new Airtable lead
  - upserts by Source Record ID
  - avoids overwriting Charlene's pipeline management on existing rows
  - adds helper columns if missing and hides them
*/

const SHEET_NAME = 'Pipeline Ops';
const PIPELINE_HEADERS = [
  'Account',
  'Primary Contact',
  'Primary Contact Role',
  'Company URL',
  'Channel',
  'Lead Source',
  'Owner',
  'Stage',
  'Value',
  'Reply Status',
  'Qualification Booked',
  'Discovery Booked',
  'Likely SKU',
  'Founder Needed',
  'Last Contact Date',
  'Next Step',
  'Next Step Date',
  'Last Activity Type',
  'Notes',
  'Created Date',
  'Days Since Last Contact',
  'Overdue Next Step',
  'Stuck Deal',
  'Health',
  'Week-to-Date Movement',
  'Source System',
  'Source Record ID',
  'Source URL',
  'Last Synced At',
];

const FORMULA_START_COLUMN = 21; // U
const FORMULA_END_COLUMN = 25;   // Y

function doPost(e) {
  try {
    const token = (e.parameter && e.parameter.token) || '';
    const expectedToken = PropertiesService.getScriptProperties().getProperty('PIPELINE_WEBHOOK_TOKEN');
    if (!expectedToken || token !== expectedToken) {
      return jsonResponse_(401, { ok: false, error: 'Unauthorized' });
    }

    const payload = JSON.parse((e.postData && e.postData.contents) || '{}');
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) return jsonResponse_(500, { ok: false, error: `Missing sheet: ${SHEET_NAME}` });

    ensureHeaders_(sheet);

    const sourceRecordId = clean_(payload.sourceRecordId);
    if (!sourceRecordId) return jsonResponse_(400, { ok: false, error: 'Missing sourceRecordId' });

    const headerMap = headerMap_(sheet);
    const existingRow = findRowBySourceRecordId_(sheet, headerMap['Source Record ID'], sourceRecordId);

    if (existingRow) {
      updateExistingRow_(sheet, headerMap, existingRow, payload);
      return jsonResponse_(200, {
        ok: true,
        action: 'updated',
        rowNumber: existingRow,
        syncedAt: new Date().toISOString(),
      });
    }

    const rowNumber = appendNewRow_(sheet, headerMap, payload);
    return jsonResponse_(200, {
      ok: true,
      action: 'inserted',
      rowNumber,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    return jsonResponse_(500, { ok: false, error: error.message });
  }
}

function appendNewRow_(sheet, headerMap, payload) {
  const rowNumber = nextAvailableRow_(sheet);
  const createdDate = toSheetDate_(payload.createdTime) || new Date();
  const notes = buildNotes_(payload);

  const row = new Array(PIPELINE_HEADERS.length).fill('');
  row[headerMap['Account'] - 1] = clean_(payload.account);
  row[headerMap['Primary Contact'] - 1] = clean_(payload.primaryContact);
  row[headerMap['Primary Contact Role'] - 1] = clean_(payload.primaryContactRole);
  row[headerMap['Company URL'] - 1] = clean_(payload.companyUrl);
  row[headerMap['Channel'] - 1] = 'Direct';
  row[headerMap['Lead Source'] - 1] = clean_(payload.leadSource) || 'Airtable site form';
  row[headerMap['Owner'] - 1] = 'Charlene';
  row[headerMap['Stage'] - 1] = 'ICP Fit';
  row[headerMap['Value'] - 1] = clean_(payload.value);
  row[headerMap['Reply Status'] - 1] = 'Wants Info';
  row[headerMap['Qualification Booked'] - 1] = 'N';
  row[headerMap['Discovery Booked'] - 1] = 'N';
  row[headerMap['Likely SKU'] - 1] = clean_(payload.likelySku) || 'Unsure';
  row[headerMap['Founder Needed'] - 1] = 'N';
  row[headerMap['Last Contact Date'] - 1] = createdDate;
  row[headerMap['Next Step'] - 1] = 'Review new inbound lead';
  row[headerMap['Next Step Date'] - 1] = createdDate;
  row[headerMap['Last Activity Type'] - 1] = 'Form Submission';
  row[headerMap['Notes'] - 1] = notes;
  row[headerMap['Created Date'] - 1] = createdDate;
  row[headerMap['Source System'] - 1] = clean_(payload.sourceSystem) || 'Airtable';
  row[headerMap['Source Record ID'] - 1] = clean_(payload.sourceRecordId);
  row[headerMap['Source URL'] - 1] = clean_(payload.sourceRecordUrl);
  row[headerMap['Last Synced At'] - 1] = new Date();

  sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  copyFormulaBlock_(sheet, rowNumber);
  return rowNumber;
}

function updateExistingRow_(sheet, headerMap, rowNumber, payload) {
  const updates = {};
  updates['Account'] = clean_(payload.account);
  updates['Primary Contact'] = clean_(payload.primaryContact);
  updates['Primary Contact Role'] = clean_(payload.primaryContactRole);
  updates['Company URL'] = clean_(payload.companyUrl);
  updates['Lead Source'] = clean_(payload.leadSource) || 'Airtable site form';
  updates['Source System'] = clean_(payload.sourceSystem) || 'Airtable';
  updates['Source Record ID'] = clean_(payload.sourceRecordId);
  updates['Source URL'] = clean_(payload.sourceRecordUrl);
  updates['Last Synced At'] = new Date();

  if (clean_(payload.value)) {
    const currentValue = clean_(sheet.getRange(rowNumber, headerMap['Value']).getValue());
    if (!currentValue) updates['Value'] = clean_(payload.value);
  }

  if (clean_(payload.likelySku)) {
    const currentSku = clean_(sheet.getRange(rowNumber, headerMap['Likely SKU']).getValue());
    if (!currentSku || currentSku === 'Unsure') updates['Likely SKU'] = clean_(payload.likelySku);
  }

  const currentNotes = clean_(sheet.getRange(rowNumber, headerMap['Notes']).getValue());
  const newNotes = buildNotes_(payload);
  if (newNotes && currentNotes.indexOf(newNotes) === -1) {
    updates['Notes'] = currentNotes ? `${currentNotes}\n\n---\n${newNotes}` : newNotes;
  }

  Object.keys(updates).forEach((header) => {
    sheet.getRange(rowNumber, headerMap[header]).setValue(updates[header]);
  });
}

function buildNotes_(payload) {
  const parts = [];
  const notes = clean_(payload.notes);
  const url = clean_(payload.sourceRecordUrl);
  if (notes) parts.push(notes);
  if (url) parts.push(`Airtable: ${url}`);
  return parts.join('\n\n');
}

function ensureHeaders_(sheet) {
  const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), PIPELINE_HEADERS.length)).getValues()[0];
  const normalizedCurrent = current.map(String);
  const missing = PIPELINE_HEADERS.filter((header) => !normalizedCurrent.includes(header));
  if (!missing.length && normalizedCurrent.slice(0, PIPELINE_HEADERS.length).join('||') === PIPELINE_HEADERS.join('||')) {
    hideHelperColumns_(sheet);
    return;
  }

  sheet.getRange(1, 1, 1, PIPELINE_HEADERS.length).setValues([PIPELINE_HEADERS]);
  hideHelperColumns_(sheet);
}

function hideHelperColumns_(sheet) {
  sheet.hideColumns(26, 4);
}

function headerMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, PIPELINE_HEADERS.length).getValues()[0];
  const map = {};
  headers.forEach((header, index) => { map[String(header)] = index + 1; });
  return map;
}

function findRowBySourceRecordId_(sheet, columnNumber, sourceRecordId) {
  const lastRow = Math.max(sheet.getLastRow(), 2);
  const values = sheet.getRange(2, columnNumber, lastRow - 1, 1).getValues().flat().map(clean_);
  const index = values.findIndex((value) => value === sourceRecordId);
  return index === -1 ? 0 : index + 2;
}

function nextAvailableRow_(sheet) {
  const lastRow = Math.max(sheet.getLastRow(), 1);
  for (let row = 2; row <= Math.max(lastRow, 501); row += 1) {
    if (!clean_(sheet.getRange(row, 1).getValue())) return row;
  }
  return lastRow + 1;
}

function copyFormulaBlock_(sheet, targetRow) {
  if (targetRow <= 2) return;
  const sourceRange = sheet.getRange(targetRow - 1, FORMULA_START_COLUMN, 1, FORMULA_END_COLUMN - FORMULA_START_COLUMN + 1);
  const targetRange = sheet.getRange(targetRow, FORMULA_START_COLUMN, 1, FORMULA_END_COLUMN - FORMULA_START_COLUMN + 1);
  sourceRange.copyTo(targetRange, SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
}

function toSheetDate_(value) {
  const text = clean_(value);
  if (!text) return '';
  const date = new Date(text);
  return isNaN(date.getTime()) ? '' : date;
}

function clean_(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function jsonResponse_(status, payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
