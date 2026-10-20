import { findMerges, missingCardEntries, type Entry } from "../engine";
import { actions, type AppData, type Store } from "../data/store";
import { Empty, entryTitle, md, METHOD_LABEL, SOURCE_LABEL, STATUS_LABEL, toast, yen } from "./common";

export function reviewCount(d: AppData, today: string) {
  return findMerges(d.entries).review.length + missingCardEntries(d.entries, today).length + d.review.filter((r) => !r.resolved).length;
}

function Line({ e, onOpen }: { e: Entry; onOpen: (e: Entry) => void }) {
  return (
    <button className="row" onClick={() => onOpen(e)}>
      <span className="d num">{md(e.date)}</span>
      <span className="t"><div>{entryTitle(e)}</div><div>{SOURCE_LABEL[e.source]}・{STATUS_LABEL[e.status]}・{METHOD_LABEL[e.method]}{e.category ? `・${e.category}` : ""}</div></span>
      <span className="a num">{yen(e.amount)}</span>
    </button>
  );
}

export function ReviewView({ store, data, today, onOpen }: { store: Store; data: AppData; today: string; onOpen: (e: Entry) => void }) {
  const { review } = findMerges(data.entries);
  const missing = missingCardEntries(data.entries, today);
  const mails = data.review.filter((r) => !r.resolved);

  const merge = async (keep: Entry, absorb: Entry) => { if (await store.run(() => actions.merge(keep, absorb))) toast("まとめました"); };
  const separate = async (e: Entry, others: Entry[]) => { if (await store.run(() => actions.notDup(e, others))) toast("別のものとして残しました"); };

  if (!review.length && !missing.length && !mails.length) return <Empty>確認することはありません</Empty>;
  return (
    <>
      {review.length > 0 && (
        <section>
          <h2>同じものかもしれない明細 <small>{review.length}件</small></h2>
          {review.map((r) => (
            <div className="panel" key={r.entry.id}>
              <div className="note">{r.reason}</div>
              <div className="list"><Line e={r.entry} onOpen={onOpen} /></div>
              <div className="note">候補</div>
              {r.candidates.map((c) => (
                <div key={c.id} style={{ display: "grid", gap: 6 }}>
                  <div className="list"><Line e={c} onOpen={onOpen} /></div>
                  <div className="btns"><button className="btn sm" onClick={() => merge(r.entry, c)}>同じもの（まとめる）</button></div>
                </div>
              ))}
              <div className="btns"><button className="btn sm ghost" onClick={() => separate(r.entry, r.candidates)}>どれとも別のもの</button></div>
            </div>
          ))}
        </section>
      )}
      {missing.length > 0 && (
        <section>
          <h2>カードで入れたのにメールから入ってこない <small>7日以上</small></h2>
          <div className="panel">
            <div className="note">金額や日付がメールと違うのかもしれません。違っていれば直してください。カードでなかったなら金種を直してください。</div>
            <div className="list">{missing.map((e) => <Line key={e.id} e={e} onOpen={onOpen} />)}</div>
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
              <div className="note">必要なら「使ったもの」として手で入れてください。</div>
              <div className="btns"><button className="btn sm ghost" onClick={async () => { if (await store.run(() => actions.resolveReview(m.id))) toast("確認済みにしました"); }}>確認済みにする</button></div>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
