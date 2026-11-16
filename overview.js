/**
 * JAFT Overview - the "Overzicht" page (phase 1: counts only).
 *
 * Responsibilities:
 *   - Pick a week; per week: new contacts per entry channel and the flow through the stages
 *     shown in that week, with ▲ where it beats last week
 *   - Events (+ / −) and LinkedIn post of the week
 *   - "Voorbije weken": three months, each week marked if something happened or something was better
 *   - "In totaal": all time, non-archived stages, with the percentage between neighbouring stages
 *   - The analysis export
 *
 * Goal 1: the feeling that we are moving forward, with real movement.
 * Goal 2: deciding whether to keep doing the same or something else.
 * JAFT knows no plan or period: what a stretch of weeks means is up to the user.
 * All figures come from Model.counts; this file only shows them.
 */

const Overview = (() => {
  const { $, esc, busy } = UI;
  const M = Model;
  let week = null, firstMonth = null, shownFor = null; // shownFor: the first day of the week these numbers belong to
  let openList = null; // the box whose list is open: { scope: 'week' | 'total', kind: 'channel' | 'stage', key, shown }

  // Three months at once; firstMonth is the first of the three. You can always scroll, back and forward:
  // weeks before the first activity and future weeks are shown, but can't be chosen.
  // The chosen week's month is in the middle; for this week, this month is the last of the three.
  const monthsFor = (w, c) => M.monthIndex(M.weekEnd(w)) - (w === c.currentWeek ? 2 : 1);
  const isoOf = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const up = on => `<span class="up ${on ? '' : 'off'}">▲</span>`;
  const MONTHS = () => t('months').split(',');

  // How the weeks run, from the shared setting, with a link to change it.
  function renderWeekRule() {
    const days = t('weekdays').split(','), first = Store.weekStartsOn();
    $('weekRule').innerHTML = `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4"/></svg>` +
      `<span>${t('week.rule', { from: `<b>${esc(days[first])}</b>`, to: `<b>${esc(days[(first + 6) % 7])}</b>` })} · ` +
      `<button type="button" class="link" id="weekRuleChange">${esc(t('week.rule_change'))}</button></span>`;
    $('weekRuleChange').onclick = () => {
      $('toSettings').click();
      $('weekStart').scrollIntoView({ block: 'center' }); $('weekStart').focus({ preventScroll: true });
    };
  }

  function renderMonths(c) {
    renderWeekRule();
    // Per month its weeks (a week belongs to the month it ends in), with the ISO week number.
    $('months').innerHTML = [0, 1, 2].map(k => {
      const mi = firstMonth + k, m = mi % 12, y = Math.floor(mi / 12);
      let cells = '';
      // Whole months: also the weeks before the first activity (grey, not clickable).
      const last = new Date(y, m + 1, 0).getDate();
      for (let w = M.weekOf(M.day(isoOf(y, m, 1))); w <= M.weekOf(M.day(isoOf(y, m, last))) + 1; w++) {
        if (M.monthIndex(M.weekEnd(w)) !== mi) continue;
        const before = w < c.firstWeek, future = w > c.currentWeek;
        const s = before ? { something: false, better: false } : c.weekState(w);
        const cls = future ? 'future' : s.better ? 'better' : s.something ? 'something' : '';
        const from = M.weekStart(w), to = from + 6, same = M.dateOf(from).getMonth() === M.dateOf(to).getMonth();
        // With weekdays, so it's clear where a week starts and ends: 'do 5 – wo 11 nov', 'do 29 okt – wo 4 nov'.
        const range = t('week.range_cell', { from: same ? M.fmtWeekdayDate(from) : M.fmtDayLong(from), to: M.fmtDayLong(to) });
        cells += `<button class="wc ${cls} ${w === week ? 'sel' : ''}" data-w="${w}" ${future || before ? 'disabled' : ''}><b>${esc(t('week.number', { n: M.weekNumber(w) }))}</b><span>${esc(range)}</span></button>`;
      }
      const name = MONTHS()[m];
      return `<div class="cal"><h4>${esc(name)}${y !== new Date().getFullYear() ? ' ' + y : ''}</h4>${cells}</div>`;
    }).join('');
  }

  // Grid: entry channels, arrow, then the stages with room for an arrow between them.
  const gridFor = n => ({ cols: '1.15fr 40px ' + Array.from({ length: n }, () => '1fr').join(' 56px '), min: 260 + n * 130 });

  function renderFlow(c) {
    const w = week, maxPos = c.maxPosFor(w);
    const stages = c.weekStages(w);
    const now = stages.map(s => c.visitsInWeek(s.id, w));
    const before = stages.map(s => c.visitsInWeek(s.id, w - 1, maxPos));
    const channels = Store.channels();

    // A box with a number can be tapped: its list opens under the block.
    const pick = (scope, kind, key, n) => n ? ` tappable${isOpen(scope, kind, key) ? ' on' : ''}" role="button" tabindex="0" data-scope="${scope}" data-kind="${kind}" data-key="${esc(key)}` : '';
    const channelBlock = (list, prev) => `<div class="ch">${channels.map(ch => {
      const n = c.byChannel(list, ch.key), better = prev ? n > c.byChannel(prev, ch.key) : false;
      return `<div class="it ${n ? '' : 'zero'}${pick(prev ? 'week' : 'total', 'channel', ch.key, n)}"><span>${esc(Store.channelLabel(ch.key))}</span><span><b>${n}</b>${prev ? up(better) : ''}</span></div>`;
    }).join('')}</div>`;
    const arrow = '<div class="pa"><svg class="ic"><use href="#i-arrow"/></svg></div>';
    // Colour grows along the funnel: the further, the stronger. The end stage is gold.
    const level = (s, i, n) => s.id === M.END_STAGE ? 4 : i === 0 ? 1 : i >= n - 2 ? 3 : 2;
    const node = (s, i, v, better) => `<div class="node lv${level(s, i, stages.length)} ${v ? '' : 'zero'}${pick('week', 'stage', s.id, v)}"><b>${v}</b><span>${esc(Store.stageLabel(s))}</span>${up(better)}</div>`;

    // Actions of the week: events +/− and the post.
    const a = c.actions(w), av = c.actions(w - 1, maxPos);
    $('weekActions').innerHTML =
      `<span class="pl">${esc(t('week.events'))} <button type="button" class="step" id="evMinus" aria-label="${esc(t('week.event_minus'))}" ${a.events ? '' : 'disabled'}>−</button><b class="${a.events ? 'on' : ''}">${a.events}</b><button type="button" class="step" id="evPlus" aria-label="${esc(t('week.event_plus'))}">+</button>${up(a.events > av.events)}</span>` +
      `<label class="pl check"><input type="checkbox" id="postToggle" ${a.post ? 'checked' : ''}> ${esc(t('week.post'))}</label>`;

    const g = gridFor(stages.length);
    $('flowWeek').style.gridTemplateColumns = g.cols; $('flowWeek').style.minWidth = g.min + 'px';
    $('flowWeek').innerHTML = channelBlock(c.newInWeek(w), c.newInWeek(w - 1, maxPos)) + arrow +
      stages.map((s, i) => node(s, i, now[i], now[i] > before[i]) + (i < stages.length - 1 ? '<div></div>' : '')).join('');

    const totals = c.totalStages(), tv = totals.map(s => c.total(s.id)), gt = gridFor(totals.length);
    $('flowTotal').style.gridTemplateColumns = gt.cols; $('flowTotal').style.minWidth = gt.min + 'px';
    $('flowTotal').innerHTML = channelBlock(c.contacted, null) + arrow +
      totals.map((s, i) => `<div class="node ${tv[i] ? '' : 'zero'}${pick('total', 'stage', s.id, tv[i])}"><b>${tv[i]}</b><span>${esc(Store.stageLabel(s))}</span></div>` +
        (i < totals.length - 1 ? `<div class="pa"><b>${tv[i] ? M.pct(tv[i + 1] / tv[i]) : ''}</b><svg class="ic"><use href="#i-arrow"/></svg></div>` : '')).join('');
    renderWho(c);
  }

  /* ---------- who is in a number ---------- */

  const isOpen = (scope, kind, key) => !!openList && openList.scope === scope && openList.kind === kind && openList.key === key;

  // The list under a block: the contacts behind the tapped number, most recent first.
  function renderWho(c) {
    ['week', 'total'].forEach(scope => {
      const el = $(scope === 'week' ? 'flowWeekList' : 'flowTotalList');
      const o = openList && openList.scope === scope ? openList : null;
      const rows = o ? c.whoIn(o.kind, o.key, scope === 'week' ? week : null) : [];
      el.classList.toggle('hidden', !rows.length);
      if (!rows.length) { el.innerHTML = ''; return; }
      const title = o.kind === 'channel' ? Store.channelLabel(o.key) : Store.stageLabel(o.key);
      const n = rows.reduce((s, r) => s + r.times, 0);
      // A long list starts with the most recent ones; "Toon meer" adds the same number again each time,
      // so a list of 500 never puts 500 rows on the screen at once.
      const limit = Math.min(rows.length, o.shown || JAFT_CONFIG.listLength);
      el.innerHTML = `<div class="who-head"><b>${esc(title)} · ${n}</b><button type="button" class="link" data-close>${esc(t('who.close'))}</button></div>` +
        rows.slice(0, limit).map(r => {
          const p = r.person, company = p.companyId ? (Store.company(p.companyId) || {}).name : t('list.no_company');
          const sub = [company, Store.channelLabel(p.entryChannel), M.fmtDayLong(r.day) + (r.times > 1 ? ' · ' + t('who.times', { n: r.times }) : '')].filter(Boolean).join(' · ');
          const pill = p.active ? `<span class="pill">${esc(Store.stageLabel(p.stageId))}</span>` : `<span class="pill inactive">${esc(t('status.inactive'))}</span>`;
          return `<button type="button" class="item ${p.active ? '' : 'off'}" data-id="${esc(p.id)}"><span class="r1"><b>${esc(p.name)}</b>${pill}</span><span class="sub">${esc(sub)}</span></button>`;
        }).join('') +
        (limit < rows.length ? `<button type="button" class="more" data-more>${esc(t('who.more', { n: rows.length - limit }))}</button>` : '');
    });
  }

  function onFlowClick(e) {
    const box = e.target.closest('.tappable');
    if (box) {
      const o = { scope: box.dataset.scope, kind: box.dataset.kind, key: box.dataset.key };
      openList = isOpen(o.scope, o.kind, o.key) ? null : o;
      renderFlow(Store.counts());
      const el = $(o.scope === 'week' ? 'flowWeekList' : 'flowTotalList');
      if (openList) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    if (e.target.closest('[data-close]')) { openList = null; return renderFlow(Store.counts()); }
    if (e.target.closest('[data-more]')) { openList.shown = (openList.shown || JAFT_CONFIG.listLength) + JAFT_CONFIG.listLength; return renderFlow(Store.counts()); }
    const item = e.target.closest('.item');
    if (item) {
      // The contact opens on the input page; "Terug" comes back here with the list still open.
      const listId = e.currentTarget.id;
      App.showPage('input');
      Contacts.openDetail(item.dataset.id, () => { App.showPage('overview'); const el = $(listId); if (el) el.scrollIntoView({ block: 'center' }); }, 'detail.back_overview');
    }
  }

  function render() {
    // A week number means a different week once the first day of the week changes: start again at this week.
    if (shownFor !== Store.weekStartsOn()) { week = null; firstMonth = null; shownFor = Store.weekStartsOn(); }
    const c = Store.counts();
    if (week === null || week > c.currentWeek) week = c.currentWeek;
    if (firstMonth === null) firstMonth = monthsFor(week, c);
    $('wLabel').textContent = t('week.number', { n: M.weekNumber(week) }) + (week === c.currentWeek ? ' · ' + t('week.this') : '');
    $('wRange').textContent = t('week.range', { from: M.fmtDayLong(M.weekStart(week)), to: M.fmtDayLong(M.weekStart(week) + 6) });
    $('wPrev').disabled = week <= c.firstWeek; $('wNext').disabled = week >= c.currentWeek;
    const mi = M.monthIndex(M.weekEnd(week));
    if (mi < firstMonth || mi > firstMonth + 2) firstMonth = monthsFor(week, c);
    renderFlow(c); renderMonths(c);
  }

  async function weekAction(kind, value) {
    // A tap for this week is stored on today, so it can be compared fairly with last week up to the same
    // weekday. A tap for an earlier week is stored on that week's first day.
    const T = M.today(), on = week === M.weekOf(T) ? T : M.weekStart(week);
    const r = await Store.addWeekAction(M.iso(on), kind, value);
    const text = kind === 'event' ? t(value > 0 ? 'toast.event_plus' : 'toast.event_minus', { n: M.weekNumber(week) }) : t(value ? 'toast.post_on' : 'toast.post_off', { n: M.weekNumber(week) });
    Toast.show(text, '', r.undo);
    render();
  }

  function init() {
    $('wPrev').onclick = () => { week--; render(); };
    $('wNext').onclick = () => { week++; render(); };
    ['flowWeek', 'flowWeekList', 'flowTotal', 'flowTotalList'].forEach(id => {
      $(id).addEventListener('click', onFlowClick);
      $(id).addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('tappable')) { e.preventDefault(); onFlowClick(e); } });
    });
    $('mPrev').onclick = () => { firstMonth--; renderMonths(Store.counts()); };
    $('mNext').onclick = () => { firstMonth++; renderMonths(Store.counts()); };
    $('months').onclick = e => { const b = e.target.closest('.wc[data-w]'); if (b && !b.disabled) { week = +b.dataset.w; render(); } };
    $('weekActions').addEventListener('click', e => {
      const b = e.target.closest('.step'); if (!b || b.disabled) return;
      busy(b, () => weekAction('event', b.id === 'evPlus' ? 1 : -1));
    });
    $('weekActions').addEventListener('change', e => {
      if (e.target.id === 'postToggle') busy(e.target, () => weekAction('post', e.target.checked ? 1 : 0));
    });
    // Inactive only when asked: the popup's box is unticked every time.
    $('exportAnalysis').onclick = () => busy($('exportAnalysis'), async () => {
      const picked = await UI.askChoice({
        title: t('export.ask_title'), text: t('export.ask_text'), ok: t('export.ok'),
        items: [{ id: 'inactive', label: t('export.with_inactive_all'), checked: false }]
      });
      if (!picked) return;
      UI.download(`jaft-analyse-${M.iso(M.today())}.json`, Exporter.analysis({ withInactive: picked.includes('inactive') }));
    });
  }

  return { init, render };
})();
