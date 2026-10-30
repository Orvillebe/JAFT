/**
 * JAFT UI - shared pieces for all screens.
 *
 * Responsibilities:
 *   UI       - DOM shortcuts, escaping, button rows, growing text fields, busy buttons,
 *              confirmation popup, file download
 *   Toast    - the message at the bottom, with "Ongedaan" when something can be undone
 *   Recent   - the "Net ingegeven" list of this session
 *   Reward   - after saving, show what beats last week
 *   SwipeRows - rows you can swipe (phone) or hover (laptop) to edit or delete, as in JATL
 *
 * The screens themselves: contacts.js, companies.js, overview.js, settings.js.
 */

const UI = (() => {
  const $ = id => document.getElementById(id);
  const q = sel => document.querySelector(sel);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // items: [[key, label, extra attributes?]]
  const seg = (items, sel) => items.map(([k, l, attr = '']) => `<button type="button" data-k="${esc(k)}" aria-pressed="${k === sel}" ${attr}>${esc(l)}</button>`).join('');
  const chips = (items, sel) => items.map(([k, l]) => `<button type="button" class="chip" data-k="${esc(k)}" aria-pressed="${k === sel}">${esc(l)}</button>`).join('');

  // Text fields grow with their content, so everything stays visible.
  function grow(el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; }
  const regrowAll = () => document.querySelectorAll('textarea').forEach(grow);

  // Runs a save and blocks the button while it runs, so a double tap never saves twice.
  // An error shows in the toast; the form stays filled in to try again.
  async function busy(btn, fn) {
    if (btn.classList.contains('busy')) return;
    btn.classList.add('busy');
    try { await fn(); } catch (e) { Toast.error(e); } finally { btn.classList.remove('busy'); }
  }

  // Deleting always asks first, in a popup (as in JATL).
  const confirmPopup = text => window.confirm(text);

  function download(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return { $, q, esc, seg, chips, grow, regrowAll, busy, confirmPopup, download };
})();


const Toast = (() => {
  const { $ } = UI;
  let undo = null, timer = null;

  // kind: '' (plain), 'win' (better than last week), 'gold' (an order), 'error'
  function show(text, kind = '', undoFn = null) {
    undo = undoFn;
    $('toastText').textContent = text;
    $('toastUndo').classList.toggle('hidden', !undoFn);
    $('toast').className = 'toast on ' + kind;
    clearTimeout(timer);
    timer = setTimeout(() => $('toast').classList.remove('on'), kind === 'error' ? 8000 : 4500);
  }

  function error(e, what = t('error.not_saved')) {
    console.error(e);
    show(`${what}: ${(e && e.message) || e}`, 'error');
  }

  function init() {
    $('toastUndo').onclick = async () => {
      const u = undo;
      undo = null;
      $('toast').classList.remove('on');
      if (!u) return;
      try { await u(); App.refresh(); show(t('toast.undone')); }
      catch (e) { error(e, t('error.undo_failed')); }
    };
  }

  return { show, error, init };
})();


const Recent = (() => {
  const { $, esc } = UI;
  const list = [];

  // x: { personId } for a person (name and next step come from the Store), or { name, company }.
  function add(x) { list.unshift(x); render(); return x; }
  function remove(x) { const i = list.indexOf(x); if (i >= 0) list.splice(i, 1); render(); }

  function render() {
    const M = Model;
    $('recent').innerHTML = list.length ? list.slice(0, 10).map(x => {
      const p = x.personId ? Store.person(x.personId) : null;
      const name = p ? p.name : x.name, company = p ? p.companyName : x.company, n = p && p.nextStep;
      return `<div class="recent-item"><b>${esc(name)}</b>${company ? ', ' + esc(company) : ''}<span>${esc(x.line)} · ${M.fmtDayLong(x.day)}${n ? ' · ' + esc(t('recent.next', { text: n.text || t('next.default'), day: M.fmtDayLong(n.day) })) : ''}</span></div>`;
    }).join('') : `<div class="recent-empty">${esc(t('recent.empty'))}</div>`;
  }

  return { add, remove, render };
})();


const Reward = (() => {
  // before: Store.counts().improvements(w) just before saving.
  // The furthest stage that improved wins; the first order of the week is gold.
  function show(before, w, plain, undo) {
    const after = Store.counts().improvements(w);
    for (const s of Store.stages().slice().reverse()) {
      const b = before[s.id], a = after[s.id];
      if (!b || !a) continue;
      const kind = s.id === Model.END_STAGE ? 'gold' : 'win', label = Store.stageLabel(s).toLowerCase();
      if (b.now === 0 && a.now > 0 && s.id !== Model.START_STAGE) return Toast.show(t('reward.first', { stage: label }), kind, undo);
      if (!b.better && a.better) return Toast.show(t('reward.more', { stage: label }), kind, undo);
    }
    Toast.show(plain, '', undo);
  }
  return { show };
})();


const SwipeRows = (() => {
  // Markup for one row. Phone: swipe left shows "Bewerken", swipe right shows "Verwijder" (as in JATL).
  // Laptop: a pencil and a × appear on hover or keyboard focus.
  function html(id, inner, { canEdit = true, canDelete = true } = {}) {
    const esc = UI.esc;
    return `<div class="swipe" data-id="${esc(id)}">` +
      (canDelete ? `<div class="swipe-under left"><button type="button" class="swipe-btn del">${esc(t('row.delete'))}</button></div>` : '') +
      `<div class="swipe-row">${inner}<span class="row-tools">` +
        (canEdit ? `<button type="button" class="tool edit" aria-label="${esc(t('row.edit'))}" title="${esc(t('row.edit'))}"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg></button>` : '') +
        (canDelete ? `<button type="button" class="tool del" aria-label="${esc(t('row.delete'))}" title="${esc(t('row.delete'))}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>` : '') +
      `</span></div>` +
      (canEdit ? `<div class="swipe-under right"><button type="button" class="swipe-btn edit">${esc(t('row.edit'))}</button></div>` : '') +
      `</div>`;
  }

  function closeAll(container, except) {
    container.querySelectorAll('.swipe.open-left, .swipe.open-right').forEach(w => {
      if (w === except) return;
      w.classList.remove('open-left', 'open-right');
      w.querySelector('.swipe-row').style.transform = '';
    });
  }

  // handlers: { onEdit(id), onDelete(id), onTap(id, event) }
  function bind(container, handlers) {
    container.querySelectorAll('.swipe').forEach(wrap => {
      const row = wrap.querySelector('.swipe-row'), id = wrap.dataset.id;
      const hasLeft = !!wrap.querySelector('.swipe-under.left'), hasRight = !!wrap.querySelector('.swipe-under.right');
      let startX = 0, startY = 0, dx = 0, moved = false, horizontal = null;
      const W = 96;

      row.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX; startY = e.touches[0].clientY; dx = 0; moved = false; horizontal = null;
        row.style.transition = 'none';
      }, { passive: true });
      row.addEventListener('touchmove', e => {
        const x = e.touches[0].clientX - startX, y = e.touches[0].clientY - startY;
        if (horizontal === null && (Math.abs(x) > 8 || Math.abs(y) > 8)) horizontal = Math.abs(x) > Math.abs(y);
        if (!horizontal) return;
        moved = true;
        const base = wrap.classList.contains('open-left') ? -W : wrap.classList.contains('open-right') ? W : 0;
        dx = Math.max(hasRight ? -W : 0, Math.min(hasLeft ? W : 0, base + x));
        row.style.transform = `translateX(${dx}px)`;
      }, { passive: true });
      row.addEventListener('touchend', () => {
        row.style.transition = 'transform .2s';
        if (!moved) return;
        closeAll(container, wrap);
        wrap.classList.remove('open-left', 'open-right');
        if (dx < -40) { wrap.classList.add('open-left'); row.style.transform = `translateX(${-W}px)`; }
        else if (dx > 40) { wrap.classList.add('open-right'); row.style.transform = `translateX(${W}px)`; }
        else row.style.transform = '';
      });

      row.addEventListener('click', e => {
        if (moved) { moved = false; return; }
        if (e.target.closest('.tool.edit')) { e.stopPropagation(); return handlers.onEdit && handlers.onEdit(id); }
        if (e.target.closest('.tool.del')) { e.stopPropagation(); return handlers.onDelete && handlers.onDelete(id); }
        if (wrap.classList.contains('open-left') || wrap.classList.contains('open-right')) { closeAll(container); return; }
        if (handlers.onTap) handlers.onTap(id, e);
      });
      const del = wrap.querySelector('.swipe-btn.del'), edit = wrap.querySelector('.swipe-btn.edit');
      if (del) del.onclick = () => { closeAll(container); handlers.onDelete && handlers.onDelete(id); };
      if (edit) edit.onclick = () => { closeAll(container); handlers.onEdit && handlers.onEdit(id); };
    });
  }

  return { html, bind, closeAll };
})();
