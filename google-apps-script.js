/**
 * WELL-BEING SURVEY — Google Apps Script
 * ─────────────────────────────────────────────────────────────────
 * SETUP (one-time):
 *
 *  1. Open your Google Sheet (create a new blank one).
 *  2. Click Extensions → Apps Script.
 *  3. Delete any existing code in the editor, paste this entire file.
 *  4. Click the floppy-disk Save icon. Name the project anything.
 *  5. Click Deploy → New deployment.
 *       • Type: Web app
 *       • Execute as: Me
 *       • Who has access: Anyone
 *  6. Click Deploy → Authorise access (follow the prompts).
 *  7. Copy the Web App URL that appears (looks like:
 *       https://script.google.com/macros/s/AKfy.../exec)
 *  8. Paste that URL into mental-health-survey.html where it says:
 *       const GOOGLE_SHEET_URL = 'PASTE_YOUR_WEB_APP_URL_HERE';
 *  9. Every time you change this script, do Deploy → Manage
 *     deployments → click the pencil icon → Version: New version → Deploy.
 * ─────────────────────────────────────────────────────────────────
 */

const SHEET_NAME = 'Responses';

// Column headers — order must match buildRow() below
const HEADERS = [
  'Timestamp',
  'Participant ID',
  'Age',
  'Gender',
  // Scored sections
  'PHQ-9 Score',         'PHQ-9 Level',
  'GAD-7 Score',         'GAD-7 Level',
  'ADHD Score',          'ADHD Level',
  'OCI-R Score',         'OCI-R Level',
  'Social Anxiety Score','Social Anxiety Level',
  'WHO-5 Score',         'WHO-5 Level',
  'SWLS Score',          'SWLS Level',
  'Cultural WB Score',   'Cultural WB Level',
  // Bipolar MDQ (not scored the same way — report count of Yes + follow-up)
  'MDQ Part A (Yes count / 13)',
  'MDQ Same period (B)',
  'MDQ Problem severity (C)',
  'MDQ Family history (D)',
  'MDQ Prior diagnosis (E)',
  // PQ-B
  'PQ-B Positive items (/ 13)',
  // Good Day
  'Good Days / Week',
  'What makes a good day',
  'Mood-lift activities',
  'One small good thing',
  // Well-being open
  'Joy / Peace activity',
  'Support needed',
  // Raw answers (full JSON for archiving)
  'Raw Answers (JSON)',
];

function doPost(e) {
  try {
    const raw = e.postData.contents;
    const data = JSON.parse(raw);
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    let sheet  = ss.getSheetByName(SHEET_NAME);

    // Create sheet + freeze header row on first run
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(HEADERS);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, HEADERS.length)
           .setFontWeight('bold')
           .setBackground('#6b4f9e')
           .setFontColor('#ffffff');
      sheet.setColumnWidth(HEADERS.length, 400); // wider for JSON column
    }

    sheet.appendRow(buildRow(data));

    return respond({ status: 'ok' });
  } catch (err) {
    return respond({ status: 'error', message: err.toString() });
  }
}

// Handle preflight OPTIONS (not strictly needed for no-cors but belt-and-suspenders)
function doGet(e) {
  return respond({ status: 'ok', message: 'Survey endpoint is live.' });
}

// ── Build one spreadsheet row from submitted answers ──────────────
function buildRow(d) {
  const a = d.raw_answers || d; // support both formats

  // Section scores (mirroring JS scoring in the HTML)
  function sum(prefix, n, base) {
    base = base || 0;
    let t = 0;
    for (let i = 1; i <= n; i++) {
      const v = a[prefix + i];
      if (v !== undefined && v !== '') t += Number(v);
    }
    return t;
  }

  const phqScore  = sum('phq', 9);
  const gadScore  = sum('gad', 7);
  const adhdScore = sum('adhd', 6);
  const ocirScore = sum('ocir', 18);
  const sadScore  = sum('sad', 10);
  const who5Score = sum('who', 5);
  const swlsScore = sum('swls', 5); // stored as 1-based in sheet
  const cwbScore  = sum('cwb', 8);

  // MDQ Part A: count Yes answers (value === '1')
  let mdqYesCount = 0;
  for (let i = 1; i <= 13; i++) {
    if (String(a['mdq' + i]) === '1') mdqYesCount++;
  }

  // PQ-B: count positive (Yes) items
  let pqbPositive = 0;
  for (let i = 1; i <= 13; i++) {
    if (String(a['pqb' + i + '_yn']) === '1') pqbPositive++;
  }

  // Good days per week label
  const gooddayLabels = ['Zero','1–2 days','3–4 days','5–6 days','Every day'];
  const gooddayLabel  = gooddayLabels[Number(a['goodday2'])] || a['goodday2'] || '';

  return [
    d.timestamp || new Date().toISOString(),
    a['participant_id'] || d.participant?.id || '',
    a['age']            || d.participant?.age || '',
    a['gender']         || d.participant?.gender || '',

    phqScore,  interpret(phqScore, [[4,'Minimal'],[9,'Mild'],[14,'Moderate'],[19,'Moderately severe'],[27,'Severe']]),
    gadScore,  interpret(gadScore, [[4,'Minimal'],[9,'Mild'],[14,'Moderate'],[21,'Severe']]),
    adhdScore, interpret(adhdScore,[[8,'Low likelihood'],[16,'Moderate'],[24,'High likelihood']]),
    ocirScore, interpret(ocirScore,[[20,'Below threshold'],[40,'Mild–Moderate'],[72,'Severe']]),
    sadScore,  interpret(sadScore, [[8,'Low'],[20,'Moderate'],[40,'High']]),
    who5Score, interpret(who5Score,[[12,'Low well-being'],[17,'Moderate'],[25,'Good well-being']]),
    swlsScore, interpret(swlsScore,[[9,'Extremely dissatisfied'],[14,'Dissatisfied'],[19,'Slightly below average'],[24,'Average'],[29,'Satisfied'],[35,'Extremely satisfied']]),
    cwbScore,  interpret(cwbScore, [[20,'Needs attention'],[32,'Moderate'],[40,'Strong']]),

    mdqYesCount + ' / 13',
    yesNo(a['mdqB']),
    ['No problem','Minor','Moderate','Serious'][Number(a['mdqC'])] || '',
    yesNo(a['mdqD']),
    yesNo(a['mdqE']),

    pqbPositive + ' / 13',

    gooddayLabel,
    a['goodday1'] || '',
    a['goodday3'] || '',
    a['goodday4'] || '',
    a['wb_open1'] || '',
    a['wb_open2'] || '',

    JSON.stringify(a),
  ];
}

// ── Helpers ───────────────────────────────────────────────────────
function interpret(score, ranges) {
  for (const [max, label] of ranges) {
    if (score <= max) return label;
  }
  return '—';
}

function yesNo(v) {
  if (v === undefined || v === '') return '';
  return String(v) === '1' ? 'Yes' : 'No';
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
