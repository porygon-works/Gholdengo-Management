/**
 * Gholdengo 家計簿：三井住友カードの通知メールを読んで Supabase に入れる
 *
 * 準備（README の「GAS」を参照）
 *   スクリプトプロパティに次の4つを入れる
 *     SUPABASE_URL          例 https://xxxx.supabase.co
 *     SUPABASE_SERVICE_KEY  Supabase の service_role キー（RLS を通らない強い鍵。ここ以外に置かない）
 *     OWNER_USER_ID         Supabase の Authentication → Users にある自分のユーザーの UID
 *     SINCE                 この日より前のメールは読まない（例 2026/10/20）。移行したデータと重ならないようにする
 *   setup() を1回実行して、15分ごとのトリガーを作る
 *
 * しくみ
 *   - 毎回、直近3日の vpass.ne.jp からのメールをすべて読む（Gmail のラベルはスレッド単位なので使わない）
 *   - メールID＋何件目か を source_ref にして入れる。DB で重複禁止にしているので、何度読んでも二重にならない
 *   - 重複のまとめ（速報と確定明細、手入力との照合）はアプリが開いたときに行う。ここでは読んで入れるだけ
 */

var SENDER = 'from:vpass.ne.jp';

function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'run') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('run').timeBased().everyMinutes(15).create();
  run();
}

/** 15分ごとに動く */
function run() {
  ingest_('newer_than:3d');
}

/** 初めに一度だけ、過去のメールをまとめて読むとき用（SINCE より前は読まない） */
function backfill() {
  ingest_('newer_than:60d');
}

function config_() {
  var p = PropertiesService.getScriptProperties();
  var c = { url: p.getProperty('SUPABASE_URL'), key: p.getProperty('SUPABASE_SERVICE_KEY'), owner: p.getProperty('OWNER_USER_ID'), since: p.getProperty('SINCE') || '' };
  if (!c.url || !c.key || !c.owner) throw new Error('スクリプトプロパティ SUPABASE_URL / SUPABASE_SERVICE_KEY / OWNER_USER_ID を入れてください');
  c.url = c.url.replace(/\/$/, '');
  return c;
}

function ingest_(range) {
  var c = config_();
  var rules = fetchRules_(c);
  var since = c.since ? new Date(c.since.replace(/\//g, '-') + 'T00:00:00+09:00') : null;
  var threads = GmailApp.search(SENDER + ' ' + range, 0, 200);
  var entries = [], bills = [], reviews = [];
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      if (since && m.getDate() < since) return;
      var r = parseMessage(m.getSubject(), m.getPlainBody(), m.getDate(), m.getId());
      if (!r) return; // 家計簿に関係ないメール（認証コードなど）
      if (r.error) { reviews.push({ user_id: c.owner, kind: 'mail', title: m.getSubject(), body: r.error + '\n\n' + m.getPlainBody().slice(0, 1500), source_ref: 'mail:' + m.getId() }); return; }
      (r.entries || []).forEach(function (e) {
        e.user_id = c.owner;
        e.category = categorize(e.shop, rules);
        entries.push(e);
      });
      (r.bills || []).forEach(function (b) { b.user_id = c.owner; bills.push(b); });
    });
  });
  if (entries.length) post_(c, 'entries', entries, 'user_id,source_ref', 'ignore-duplicates');
  if (bills.length) post_(c, 'card_bills', bills, 'user_id,pay_date', 'merge-duplicates');
  if (reviews.length) post_(c, 'review', reviews, 'user_id,source_ref', 'ignore-duplicates');
  console.log('読んだスレッド ' + threads.length + '・明細 ' + entries.length + '・請求 ' + bills.length + '・読めない ' + reviews.length);
}

function post_(c, table, rows, onConflict, resolution) {
  var res = UrlFetchApp.fetch(c.url + '/rest/v1/' + table + '?on_conflict=' + onConflict, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: c.key, Authorization: 'Bearer ' + c.key, Prefer: 'resolution=' + resolution + ',return=minimal' },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error(table + ' に書けませんでした: ' + res.getResponseCode() + ' ' + res.getContentText());
}

function fetchRules_(c) {
  var res = UrlFetchApp.fetch(c.url + '/rest/v1/rules?select=pattern,category&user_id=eq.' + c.owner, {
    headers: { apikey: c.key, Authorization: 'Bearer ' + c.key }, muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error('ルールを読めませんでした: ' + res.getContentText());
  return JSON.parse(res.getContentText());
}

// ---------- メールを読む（テストは gas/parse.test.ts） ----------

var num_ = function (s) { return parseInt(String(s).normalize('NFKC').replace(/[^0-9]/g, ''), 10) || 0; };
var ymd_ = function (s) { var p = String(s).normalize('NFKC').split('/'); return p[0] + '-' + ('0' + p[1]).slice(-2) + '-' + ('0' + p[2]).slice(-2); };

/**
 * 1通のメールを読む。家計簿に関係なければ null、読めなければ { error }。
 * 戻り値 { entries: [...], bills: [...] }
 */
function parseMessage(subject, body, date, id) {
  body = String(body || '').replace(/\r/g, '');
  var isFlash = /ご利用のお知らせ/.test(subject);
  var isStatement = /ご利用明細のお知らせ/.test(subject);
  var isBill = /お支払い金額のお知らせ/.test(subject);
  if (!isFlash && !isStatement && !isBill) return null;

  if (isBill) {
    var dm = /支払日[\s　]*(\d{1,2})月(\d{1,2})日/.exec(body);
    var am = /お支払い金額[^\n]*\n\s*([\d,，]+)円/.exec(body) || /お支払い金額[\s\S]{0,40}?([\d,，]+)円/.exec(body);
    if (!dm || !am) return { error: '支払日か金額が読めませんでした' };
    var sent = toJst_(date);
    var y = +sent.slice(0, 4), mo = +dm[1];
    if (mo < +sent.slice(5, 7)) y++; // 12月に届いた1月の支払い
    return { bills: [{ pay_date: y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + dm[2]).slice(-2), amount: num_(am[1]), source_ref: 'bill:' + id }] };
  }

  var items = [];
  // 書式1（テキスト版）：◇利用日：2026/10/17 23:10 ◇利用先：… ◇利用取引：買物 ◇利用金額：7,546円
  var re1 = /◇利用日：\s*(\d{4}\/\d{1,2}\/\d{1,2})[^\n]*\n◇利用先：\s*([^\n]*)\n◇利用取引：\s*([^\n]*)\n◇利用金額：\s*(-?[\d,，]+)円/g;
  var m;
  while ((m = re1.exec(body))) items.push({ date: ymd_(m[1]), shop: m[2].trim(), deal: m[3].trim(), amount: m[4] });
  if (!items.length) {
    // 書式2（HTML版を文字にしたもの）：ご利用日時：2026/10/17 23:10 ３・６・５酒場…（買物） 7546円
    var re2 = /ご利用日時：\s*(\d{4}\/\d{1,2}\/\d{1,2})(?:\s+\d{1,2}:\d{2})?\s+(.+?)（([^（）]+)）\s*(-?[\d,，]+)円/g;
    while ((m = re2.exec(body))) items.push({ date: ymd_(m[1]), shop: m[2].trim(), deal: m[3].trim(), amount: m[4] });
  }
  if (!items.length) return { error: '利用日・利用先・金額が読めませんでした' };

  var entries = [], errors = [];
  items.forEach(function (it, i) {
    var amount = num_(it.amount);
    if (/取消|返品|キャンセル/.test(it.deal) || /^-/.test(it.amount)) { errors.push(it.date + ' ' + it.shop + ' ' + it.deal + ' ' + it.amount + '円'); return; }
    entries.push({
      kind: 'expense', status: isFlash ? 'flash' : 'confirmed', date: it.date, amount: amount, method: 'card',
      shop: it.shop, item: '', memo: it.deal === '買物' ? '' : it.deal, tatekae: 0,
      source: isFlash ? 'card_flash' : 'card_statement', source_ref: id + '#' + (i + 1), locked: false, not_dup: [],
    });
  });
  if (errors.length && !entries.length) return { error: '取消・返品は自動で入れません。必要なら手で直してください：\n' + errors.join('\n') };
  return { entries: entries, warnings: errors };
}

function toJst_(d) { return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10); }

// ---------- お店→費目（src/engine/rules.ts と同じ。変えるときは両方直す） ----------

function normalizeShop(s) {
  return String(s || '').normalize('NFKC').replace(/[\/／](iD|NFC|QUICPay|Apple Pay|Google Pay)$/i, '').replace(/\s+/g, ' ').trim().toLowerCase();
}
var GENERIC_ = [/^mastercard加盟店/, /^visa加盟店/, /^jcb加盟店/, /加盟店$/, /^$/];
function categorize(shop, rules) {
  var n = normalizeShop(shop);
  if (!n || GENERIC_.some(function (re) { return re.test(n); })) return null;
  var best = null, bestLen = 0;
  (rules || []).forEach(function (r) {
    var p = normalizeShop(r.pattern);
    if (p && n.indexOf(p) >= 0 && p.length > bestLen) { best = r.category; bestLen = p.length; }
  });
  return best;
}

if (typeof module !== 'undefined') module.exports = { parseMessage: parseMessage, categorize: categorize, normalizeShop: normalizeShop };
