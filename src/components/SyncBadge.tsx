/* '저장 대기 · 저장 실패' 표시 → 누르면 아직 안 올라간 기록 목록 */
import { S, book, type Rec } from '../lib/core'
import { syncLabel, retrySync, dropOp } from '../lib/store/local'
import { modal, closeModal, remodal } from '../lib/ui'

export function SyncBadge() {
  const { t, cls } = syncLabel()
  if (!t) return <span id="sync" className="sync hidden" />
  return <span id="sync" className={'sync ' + cls} onClick={openSync}>{t}</span>
}
const opName = (o: Rec) => o.fn === 'saveSnippet' ? '문장 저장: ' + String(o.local && (o.local['제목'] || o.local['내용']) || '').slice(0, 24)
  : o.fn === 'saveMemo' && o.list === 'logs' ? (o.local && o.local['종류'] === '필사순서' ? '필사 순서: ' : '독서 기록: ') + ((book(o.local && o.local['책ID']) || {})['제목'] || '')
  : o.fn === 'deleteMemo' && o.list === 'logs' ? '독서 기록 삭제'
  : o.fn === 'saveMemo' ? (o.local && o.local['종류'] === '할일' ? '할 일: ' : '메모: ') + String(o.local && o.local['내용'] || '').slice(0, 24)
  : o.fn === 'saveNote' ? '글: ' + String(o.local && (o.local['제목'] || o.local['본문']) || '').slice(0, 24)
  : o.fn === 'deleteSnippet' ? '문장 삭제' : o.fn === 'deleteMemo' ? '메모 삭제' : o.fn === 'deleteNote' ? '글 삭제' : '책 정보: ' + ((book(o.id) || {})['제목'] || '')
function SyncSheet() {
  return <>
    <h3>아직 서버에 저장되지 않은 기록</h3>
    <div className="small" style={{ marginBottom: 10 }}>이 기기에는 저장되어 있어요. 인터넷이 연결되면 자동으로 올라가요.</div>
    {S.outbox.map((o: Rec, i: number) => <div className="kw-row" key={o.cid || i}><b style={{ fontWeight: 500 }}>{opName(o)}</b><span>{o.error ? '⚠ ' + o.error : '대기 중'}</span>
      {o.error && <button className="btn" style={{ padding: '4px 10px', fontSize: 13 }} onClick={() => { if (!confirm('이 기록을 버릴까요? 되돌릴 수 없어요.')) return; dropOp(i); if (S.outbox.length) remodal(<SyncSheet />); else closeModal() }}>버리기</button>}</div>)}
    <div className="actions"><button className="btn" onClick={closeModal}>닫기</button>
      <button className="btn primary grow" onClick={() => { closeModal(); retrySync() }}>지금 다시 시도</button></div>
  </>
}
export function openSync() { if (S.outbox.length) modal(<SyncSheet />) }
