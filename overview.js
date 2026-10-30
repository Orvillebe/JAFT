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

  // Three months at once; firstMonth is the first of the three. You can always scroll, back and forward:
  // weeks before the first activity and future weeks are shown, but can't be chosen.
  // The chosen week's month is in the middle; for this week, this month is the last of the three.
  const monthsFor = (w, c) => M.monthIndex(M.weekEnd(w)) - (w === c.currentWeek ? 2 : 1);
  const isoOf = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const up = on => `<span class="up ${on ? '' : 'off'}">▲</span>`;
  const MONTHS = () => t('months').split(',');

  function renderMonths(c) {
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
        const range = t('week.range', { from: same ? String(M.dateOf(from).getDate()) : M.fmtDay(from), to: M.fmtDay(to) });
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

    const channelBlock = (list, prev) => `<div class="ch">${channels.map(ch => {
      const n = c.byChannel(list, ch.key), better = prev ? n > c.byChannel(prev, ch.key) : false;
      return `<div class="it ${n ? '' : 'zero'}"><span>${esc(Store.channelLabel(ch.key))}</span><span><b>${n}</b>${prev ? up(better) : ''}</span></div>`;
    }).join('')}</div>`;
    const arrow = '<div class="pa"><svg class="ic"><use href="#i-arrow"/></svg></div>';
    // Colour grows along the funnel: the further, the stronger. The end stage is gold.
    const level = (s, i, n) => s.id === M.END_STAGE ? 4 : i === 0 ? 1 : i >= n - 2 ? 3 : 2;
    const node = (s, i, v, better) => `<div class="node lv${level(s, i, stages.length)} ${v ? '' : 'zero'}"><b>${v}</b><span>${esc(Store.stageLabel(s))}</span>${up(better)}</div>`;

    // Actions of the week: events +/− and the post.
    const a = c.actions(w), av = c.actions(w - 1);
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
      totals.map((s, i) => `<div class="node ${tv[i] ? '' : 'zero'}"><b>${tv[i]}</b><span>${esc(Store.stageLabel(s))}</span></div>` +
        (i < totals.length - 1 ? `<div class="pa"><b>${tv[i] ? M.pct(tv[i + 1] / tv[i]) : ''}</b><svg class="ic"><use href="#i-arrow"/></svg></div>` : '')).join('');
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
    // Stored on the first day of the chosen week (today at the latest, never in the future).
    const r = await Store.addWeekAction(M.iso(Math.min(M.today(), M.weekStart(week))), kind, value);
    const text = kind === 'event' ? t(value > 0 ? 'toast.event_plus' : 'toast.event_minus', { n: M.weekNumber(week) }) : t(value ? 'toast.post_on' : 'toast.post_off', { n: M.weekNumber(week) });
    Toast.show(text, '', r.undo);
    render();
  }

  function init() {
    $('wPrev').onclick = () => { week--; render(); };
    $('wNext').onclick = () => { week++; render(); };
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
    $('exportAnalysis').onclick = () => busy($('exportAnalysis'), async () => {
      UI.download(`jaft-analyse-${M.iso(M.today())}.json`, Exporter.analysis());
    });
  }

  return { init, render };
})();
