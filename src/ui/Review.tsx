import { findMerges, missingCardEntries, overduePlans, type CardEntry } from "../engine";
import { actions, type AppData, type Store } from "../data/store";
import { CARD_SOURCE_LABEL, cardTitle, Empty, md, STATUS_LABEL, toast, yen } from "./common";
import { AccountRow } from "./Ledger";
import type { Open } from "./Sheets";

const mailCards = (d: AppData) => d.cards.filter((e) => e.card === d.settings.cards[0].id);

export function reviewCount(d: AppData, today: string) {
  return findMerges(d.cards).review.length + missingCardEntries(mailCards(d), today).length + d.review.filter((r) => !r.resolved).length + overduePlans(d, today).length;
}

function Line({ e, data, onOpen }: { e: CardEntry; data: AppData; onOpen: (o: Open) => void }) {
  const card = data.settings.cards.find((c) => c.id === e.card)?.name ?? "";
  return (
    <button className="row" onClick={() => onOpen({ type: "card", entry: e })}>
      <span className="d num">{md(e.date)}</span>
      <span className="t"><div>{cardTitle(e)}</div><div>{card}・{CARD_SOURCE_LABEL[e.source]}・{STATUS_LABEL[e.status]}{e.category ? `・${e.category}` : ""}</div></span>
      <span className="a num">{yen(e.amount)}</span>
    </button>
  );
}

export function ReviewView({ store, data, today, onOpen }: { store: Store; data: AppData; today: string; onOpen: (o: Open) => void }) {
  const { review } = findMerges(data.cards);
  const missing = missingCardEntries(mailCards(data), today);
  const overdue = overduePlans(data, today);
  const mails = data.review.filter((r) => !r.resolved);
  const merge = async (keep: CardEntry, absorb: CardEntry) => { if (await store.run(() => actions.merge(keep, absorb))) toast("まとめました"); };
  const separate = async (e: CardEntry, others: CardEntry[]) => { if (await store.run(() => actions.notDup(e, others))) toast("別のものとして残しました"); };

  if (!review.length && !missing.length && !mails.length && !overdue.length) return <Empty>確認することはありません</Empty>;
  return (
    <>
      {review.length > 0 && (
        <section>
          <h2>同じものかもしれないクレカ明細 <small>{review.length}件</small></h2>
          {review.map((r) => (
            <div className="panel" key={r.entry.id}>
              <div className="note">{r.reason}</div>
              <div className="list"><Line e={r.entry} data={data} onOpen={onOpen} /></div>
              <div className="note">候補</div>
              {r.candidates.map((c) => (
                <div key={c.id} style={{ display: "grid", gap: 6 }}>
                  <div className="list"><Line e={c} data={data} onOpen={onOpen} /></div>
                  <div className="btns"><button className="btn sm" onClick={() => merge(r.entry, c)}>同じもの（まとめる）</button></div>
                </div>
              ))}
              <div className="btns"><button className="btn sm ghost" onClick={() => separate(r.entry, r.candidates)}>どれとも別のもの</button></div>
            </div>
          ))}
        </section>
      )}
      {overdue.length > 0 && (
        <section>
          <h2>日付が過ぎた口座の予定 <small>確定にするか、消してください</small></h2>
          <div className="panel"><div className="list">{overdue.map((e) => <AccountRow key={e.id} e={e} onOpen={onOpen} showCat />)}</div></div>
        </section>
      )}
      {missing.length > 0 && (
        <section>
          <h2>{data.settings.cards[0].name}で入れたのにメールから入ってこない <small>7日以上</small></h2>
          <div className="panel">
            <div className="note">金額や日付がメールと違うのかもしれません。違っていれば直してください。</div>
            <div className="list">{missing.map((e) => <Line key={e.id} e={e} data={data} onOpen={onOpen} />)}</div>
          </div>
        </section>
      )}
      {mails.length > 0 && (
        <section>
          <h2>読めなかったメール <small>{mails.length}件</small></h2>
          {mails.map((m) => (
            <div className="panel" key={m.id}>
              <b>{m.title}</b>
              <pre className="mail">{m.body}</pre>
              <div className="note">必要なら手で入れてください。</div>
              <div className="btns"><button className="btn sm ghost" onClick={async () => { if (await store.run(() => actions.resolveReview(m.id))) toast("確認済みにしました"); }}>確認済みにする</button></div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
