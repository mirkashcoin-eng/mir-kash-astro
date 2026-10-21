// @ts-nocheck
// Operations views (orders, fulfilment, Try at Home, Private Viewing, affiliates, newsletter,
// team, daily funnel grid) and the legacy person drawer. Carried over from the old single-file
// AdminDashboard.astro with behaviour unchanged; restyled by admin.css. Fed by /api/admin/data.
import { authHeaders, callAffiliates, setLegacy } from './data';
export function initOps() {
    var ABANDONED = [];
    var DEMOS = [];
    var VIEWINGS = [];
    var PEOPLE = [];
    var ORDERS = [];
    var AFFILIATES = [];
    var SUBSCRIBERS = [];
    var FUNNEL_DAILY = {};   // { 'YYYY-MM-DD': { visitors, p1, …, bot_visitors, hidden_visitors, … } }
    var LAST_DATA = null;    // last payload, so the toggles can re-render without a refetch
    var FULFIL_PENDING = 0;
    var FILTER = 'all';   // active stage filter in the People view
    var DATE_FILTER = 'all';
    var SEARCH = '';
    // Internal / test numbers — kept out of every count and table unless "Show test
    // records" is ticked. Matches the last-10-digits key the People collection uses.
    var HIDDEN_TELS = ['7738784781', '8306883773'];
    var SHOW_HIDDEN = false;
    var tel10 = function (x) { return String(x == null ? '' : x).replace(/[^0-9]/g, '').slice(-10); };
    var isHiddenTel = function (x) { return HIDDEN_TELS.indexOf(tel10(x)) > -1; };
    var isHiddenPerson = function (p) { return p && (HIDDEN_TELS.indexOf(tel10(p.phone)) > -1 || HIDDEN_TELS.indexOf(tel10(p.id)) > -1); };
    var $ = function (id) { return document.getElementById(id); };
    var inr = function (amount, cur) {
      cur = cur || 'INR';
      if (amount == null) return '—';
      var n = Math.round(Number(amount));
      try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n); }
      catch (e) { return cur + ' ' + n; }
    };
    var when = function (iso, withTime) {
      if (!iso) return '—';
      try { return new Date(iso).toLocaleDateString('en-IN', withTime ? { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short' }); }
      catch (e) { return iso; }
    };
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var contact = function (email, phone) { return [email ? esc(email) : '', phone ? esc(phone) : ''].filter(Boolean).join(' · ') || '—'; };

    function orderPill(o) {
      if (o.cancelled) return '<span class="ad-pill ad-pill--cancel">Cancelled</span>';
      var f = String(o.fulfillment || '').toUpperCase();
      if (f.indexOf('FULFILLED') > -1 && f.indexOf('UNFULFILLED') === -1) return '<span class="ad-pill ad-pill--good">Fulfilled</span>';
      var fin = String(o.financial || '').toUpperCase();
      var paid = fin === 'PAID' ? '' : ' · ' + (fin.charAt(0) + fin.slice(1).toLowerCase());
      return '<span class="ad-pill">Ordered' + esc(paid) + '</span>';
    }
    function paymentPill(o) {
      if (o.paymentMethod === 'cod') return '<span class="ad-pill ad-pill--wait">COD</span>';
      if (o.paymentMethod === 'cashfree') return '<span class="ad-pill ad-pill--good">Online</span>';
      return '<span class="ad-pill">—</span>';
    }
    function ordersTable(orders) {
      if (!orders.length) return '<p class="ad-note ad-pad">No orders yet.</p>';
      return '<table class="ad-table"><thead><tr><th>Customer</th><th>Order</th><th>Payment</th><th>Items</th><th>Date</th><th class="r">Total</th><th>Status</th></tr></thead><tbody>' + orders.map(function (o) {
        return '<tr><td class="nm">' + esc(o.customer || 'Guest') + (o.email ? '<div class="sub">' + esc(o.email) + '</div>' : '') + '</td><td>' + esc(o.name) + '</td><td>' + paymentPill(o) + '</td><td>' + esc(o.items || '—') + '</td><td>' + when(o.createdAt) + '</td><td class="r amt">' + esc(inr(o.total && o.total.amount, o.total && o.total.currencyCode)) + '</td><td>' + orderPill(o) + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    function demoPill(status) {
      if (status === 'completed') return '<span class="ad-pill ad-pill--done">Completed</span>';
      if (status === 'confirmed') return '<span class="ad-pill ad-pill--good">Confirmed</span>';
      return '<span class="ad-pill ad-pill--wait">Requested</span>';
    }
    function demosTable(demos) {
      if (!demos.length) return '<p class="ad-note ad-pad">No Try at Home bookings yet.</p>';
      return '<table class="ad-table ad-table--click"><thead><tr><th>Customer</th><th>Status</th><th>Date &amp; slot</th><th>Bags</th><th>Contact</th><th></th></tr></thead><tbody>' + demos.map(function (d, i) {
        return '<tr data-idx="' + i + '"><td class="nm">' + esc(d.customer || 'Guest') + '</td><td>' + demoPill(d.status) + '</td><td>' + esc(d.date || '—') + (d.slot ? '<div class="sub">' + esc(d.slot) + '</div>' : '') + '</td><td>' + esc(d.bags || '—') + '</td><td class="sub">' + contact(d.email, d.phone) + '</td><td class="r"><button type="button" class="ad-rowview">View →</button></td></tr>';
      }).join('') + '</tbody></table>';
    }
    function viewingPill(status) {
      if (status === 'completed') return '<span class="ad-pill ad-pill--done">Completed</span>';
      if (status === 'confirmed') return '<span class="ad-pill ad-pill--good">Confirmed</span>';
      return '<span class="ad-pill ad-pill--wait">Requested</span>';
    }
    // "Customer" here is whoever booked — there's no shipping-address name on a Private
    // Viewing draft order (unlike demos), only email/phone, so that's the display name.
    // r.name is the Shopify draft order's own number (e.g. "#D123"), not a person.
    function viewingWho(v) { return v.email || v.phone || 'Guest'; }
    function viewingsTable(viewings) {
      if (!viewings.length) return '<p class="ad-note ad-pad">No Private Viewing bookings yet.</p>';
      return '<table class="ad-table ad-table--click"><thead><tr><th>Customer</th><th>Status</th><th>Date &amp; slot</th><th>Bags</th><th>Location</th><th>Contact</th><th></th></tr></thead><tbody>' + viewings.map(function (v, i) {
        var loc = [v.city, v.country].filter(Boolean).join(', ');
        return '<tr data-idx="' + i + '"><td class="nm">' + esc(viewingWho(v)) + '<div class="sub">' + esc(v.name || '') + '</div></td><td>' + viewingPill(v.status) + '</td><td>' + esc(v.date || '—') + (v.slot ? '<div class="sub">' + esc(v.slot) + '</div>' : '') + '</td><td>' + esc(v.bags || '—') + '</td><td class="sub">' + (loc ? esc(loc) : '—') + '</td><td class="sub">' + contact(v.email, v.phone) + '</td><td class="r"><button type="button" class="ad-rowview">View →</button></td></tr>';
      }).join('') + '</tbody></table>';
    }
    function subscribersTable(subs) {
      if (!subs) return '<p class="ad-note ad-pad">Newsletter signups aren’t available yet — add the Firebase service account (<code>FIREBASE_SERVICE_ACCOUNT</code>) in Vercel to unlock this.</p>';
      if (!subs.length) return '<p class="ad-note ad-pad">No newsletter signups yet.</p>';
      return '<table class="ad-table"><thead><tr><th>Email</th><th>Signed up</th><th>Source</th><th>In Shopify?</th></tr></thead><tbody>' + subs.map(function (s) {
        return '<tr><td class="nm">' + esc(s.email) + '</td><td>' + when(s.createdAt) + '</td><td>' + esc(s.source || 'footer') + '</td><td>' + (s.shopifyOk ? '<span class="ad-pill ad-pill--good">Yes</span>' : '<span class="ad-pill ad-pill--wait">No</span>') + '</td></tr>';
      }).join('') + '</tbody></table>';
    }
    function newsletterCsv() {
      var rows = SUBSCRIBERS || [];
      var lines = ['email,signed_up,source,in_shopify'];
      rows.forEach(function (s) {
        lines.push(['"' + String(s.email || '').replace(/"/g, '""') + '"', s.createdAt || '', s.source || 'footer', s.shopifyOk ? 'yes' : 'no'].join(','));
      });
      var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mir-kash-newsletter.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    }
    // ── Unread badges ─────────────────────────────────────────────────────────
    // Each nav badge counts records newer than the last time that tab was opened,
    // so it reads as "new since you last looked" rather than a running total.
    // Marks live in localStorage — view timestamps, not credentials, so they can
    // safely outlive the session (unlike the passcode, which never persists).
    var SEEN_LS = 'mk_admin_seen';
    var SEEN = {};
    try { SEEN = JSON.parse(localStorage.getItem(SEEN_LS) || '{}') || {}; } catch (e) { SEEN = {}; }
    function saveSeen() { try { localStorage.setItem(SEEN_LS, JSON.stringify(SEEN)); } catch (e) {} }
    // Records created after the mark. First ever visit has no mark — show nothing
    // rather than flagging the entire backlog as "new".
    function unreadCount(view, rows, stamp) {
      var mark = SEEN[view];
      if (!mark) return 0;
      var n = 0;
      for (var i = 0; i < rows.length; i++) {
        var t = new Date(stamp(rows[i]) || 0).getTime();
        if (isFinite(t) && t > mark) n++;
      }
      return n;
    }
    function setBadge(id, n) {
      var el = $(id); if (!el) return;
      el.textContent = n ? String(n) : '';
      el.classList.toggle('is-new', !!n);
    }
    // Opening a tab clears its badge and re-marks it as read from now.
    function markSeen(view) {
      SEEN[view] = Date.now();
      saveSeen();
      renderBadges();
    }
    // Badges reflect the data currently loaded; called after each fetch and on
    // every tab switch.
    function renderBadges() {
      var byCreated = function (r) { return r.createdAt; };
      setBadge('nPeople', unreadCount('people', PEOPLE, function (p) { return p.lastSeen || p.firstSeen; }));
      setBadge('nOrders', unreadCount('orders', ORDERS, byCreated));
      setBadge('nDemos', unreadCount('demos', DEMOS, byCreated));
      setBadge('nViewings', unreadCount('viewings', VIEWINGS, byCreated));
      setBadge('nAff', unreadCount('affiliates', AFFILIATES, function (a) { return a.createdAt; }));
      setBadge('nNews', unreadCount('newsletter', SUBSCRIBERS || [], function (s) { return s.createdAt; }));
      // Fulfilment is a work queue, not a feed: the badge is how much is waiting
      // on you right now, so it stays a live count rather than an unread mark.
      setBadge('nFulfil', FULFIL_PENDING);
    }

    // ── Test-record + count helpers ──────────────────────────────────────────
    function visibleOrders() {
      return ORDERS.filter(function (o) { return SHOW_HIDDEN || !isHiddenTel(o.phone); });
    }
    function visibleAbandoned() {
      return ABANDONED.filter(function (a) { return SHOW_HIDDEN || !isHiddenTel(a.phone); });
    }
    // Sum one funnel step across every stored day — real humans always, plus bots
    // and/or test records per the toggles. Used for the "People captured" KPI so it
    // is no longer capped by the 500-row People query.
    function funnelTotal(step) {
      var n = 0;
      for (var day in FUNNEL_DAILY) {
        if (!FUNNEL_DAILY.hasOwnProperty(day)) continue;
        var d = FUNNEL_DAILY[day];
        n += Number(d[step] || 0);
        if (SHOW_BOTS) n += Number(d['bot_' + step] || 0);
        if (SHOW_HIDDEN) n += Number(d['hidden_' + step] || 0);
      }
      return n;
    }
    // True until the funnel_daily backfill has run — until then the Daily funnel
    // grid and this KPI fall back to computing from the (capped) People list, so
    // there's no blank period on deploy.
    function haveFunnelAggregates() { return Object.keys(FUNNEL_DAILY).length > 0; }
    function countedPerson(p) {
      if (p.bot && !SHOW_BOTS) return false;
      if (isHiddenPerson(p) && !SHOW_HIDDEN) return false;
      return true;
    }
    function totalVisitors() {
      if (haveFunnelAggregates()) return funnelTotal('visitors');
      return PEOPLE.filter(countedPerson).length;
    }
    // ── People (every visitor who showed intent, one row each) ────────────────
    // The journey stages, in order. `key` matches Person.stage from the API.
    var STAGES = [
      { key: 'visited',  label: 'Just visited',   cls: 'ad-pill--wait' },
      { key: 'cart',     label: 'Added to bag',   cls: 'ad-pill--wait' },
      { key: 'phone',    label: 'Entered phone',  cls: 'ad-pill--good' },
      { key: 'address',  label: 'Entered address', cls: 'ad-pill--good' },
      { key: 'payment',  label: 'Abandoned at payment', cls: 'ad-pill--cancel' },
      { key: 'ordered',  label: 'Ordered',        cls: 'ad-pill--done' },
    ];
    function stageMeta(k) {
      for (var i = 0; i < STAGES.length; i++) if (STAGES[i].key === k) return STAGES[i];
      return STAGES[0];
    }
    function stagePill(k) {
      var m = stageMeta(k);
      return '<span class="ad-pill ' + m.cls + '">' + esc(m.label) + '</span>';
    }
    // Best label we have: a real name, else the phone, else the email. Legacy imports
    // only ever carry a phone, so "Visitor" is a genuine last resort.
    function personName(p) { return p.name || p.phone || p.email || 'Visitor'; }
    // Contact line under the title — skip whatever's already used as the title.
    // ── Booking progress (Try at Home / Private Viewing) ─────────────────────
    // `step` is the last step they continued from; `booked` is set when Shopify holds
    // a booking for the same phone. Lets the team follow up knowing what was picked.
    var BOOKING_STEP_DONE = { cover: 'Started', bags: 'Chose pieces', datetime: 'Chose a day', details: 'Pressed confirm' };
    function bookingFlowName(b) { return b.flow === 'private_viewing' ? 'Private Viewing' : 'Try at Home'; }
    function bookingStatus(b) {
      if (b.booked) return 'Booked' + (b.booked !== 'requested' ? ' (' + b.booked + ')' : '');
      return (BOOKING_STEP_DONE[b.step] || 'Started') + ', not booked';
    }
    function bookingDay(b) {
      if (!b.date) return '';
      return /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? fmtISO(b.date) : b.date;
    }
    function bookingPieces(b) {
      if (b.bags && b.bags.length) return b.bags.join(', ');
      return b.count ? b.count + (b.count === 1 ? ' piece' : ' pieces') : '';
    }
    function bookingLine(b) {
      return [bookingFlowName(b) + ': ' + bookingStatus(b), [bookingDay(b), b.slot].filter(Boolean).join(', ')]
        .filter(Boolean).join(' · ');
    }
    function personSub(p) {
      var title = personName(p);
      return [p.phone, p.email].filter(function (v) { return v && v !== title; })
        .map(esc).join(' · ') || '';
    }
    // ── Daily funnel grid ─────────────────────────────────────────────────────
    // One column per day of a month, one row per funnel step. A person counts on
    // the day they FIRST reached a step, so each row is "how many new people got
    // this far that day" and nobody is double-counted. The funnel rows are served
    // from the immutable funnel_daily aggregates (written server-side as each
    // person crosses each step), so a past column never changes once the day ends —
    // unlike the old client-side count from the capped People list.
    var MONTH = '';       // 'YYYY-MM'; set on first render
    var SHOW_BOTS = false; // crawlers are recorded but excluded from counts by default
    // The IST calendar day (YYYY-MM-DD) an instant falls on. Firestore stores UTC,
    // but the store's day is Mumbai's, so bucketing must match the People filters.
    function istDay(ts) {
      if (!ts) return '';
      var t = new Date(ts).getTime();
      if (!isFinite(t) || !t) return '';
      return new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    }
    function currentIstMonth() { return istDay(Date.now()).slice(0, 7); }
    function daysInMonth(m) {
      var y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
      return new Date(y, mo, 0).getDate(); // day 0 of next month = last day of this one
    }
    // The funnel rows, in order. p1/p2/p3 are cumulative milestones — the day a
    // person reached their 1st / 2nd / 3rd distinct product view — so the column
    // totals form a real funnel (everyone in p2 is also in p1).
    var DAILY_ROWS = [
      { key: 'visitors', label: 'Unique visitors' },
      { key: 'p1',       label: 'Viewed a product' },
      { key: 'p2',       label: 'Viewed a 2nd product' },
      { key: 'p3',       label: 'Viewed a 3rd+ product' },
      { key: 'cart',     label: 'Added to cart' },
      { key: 'phone',    label: 'Added phone number' },
      { key: 'address',  label: 'Added address' },
    ];
    // Bot / test visitors for `month`, from the immutable aggregates.
    function funnelMonthTotal(step, month, prefix) {
      var n = 0;
      for (var day in FUNNEL_DAILY) {
        if (!FUNNEL_DAILY.hasOwnProperty(day) || day.slice(0, 7) !== month) continue;
        n += Number(FUNNEL_DAILY[day][(prefix || '') + step] || 0);
      }
      return n;
    }
    // Builds { rowKey: { 'YYYY-MM-DD': n } } for the given month. The funnel rows
    // come from funnel_daily — immutable per-day counts written when each person
    // first reaches a step — so a column never changes once the day has passed.
    // Checkout + Ordered come from Shopify, which is authoritative for both.
    function dailyCounts(month) {
      var grid = {};
      DAILY_ROWS.forEach(function (r) { grid[r.key] = {}; });
      grid.checkout = {}; grid.ordered = {};
      var bump = function (key, day) {
        if (!day || day.slice(0, 7) !== month) return;
        grid[key][day] = (grid[key][day] || 0) + 1;
      };
      if (haveFunnelAggregates()) {
        for (var day in FUNNEL_DAILY) {
          if (!FUNNEL_DAILY.hasOwnProperty(day) || day.slice(0, 7) !== month) continue;
          var d = FUNNEL_DAILY[day];
          DAILY_ROWS.forEach(function (r) {
            var v = Number(d[r.key] || 0);
            if (SHOW_BOTS) v += Number(d['bot_' + r.key] || 0);
            if (SHOW_HIDDEN) v += Number(d['hidden_' + r.key] || 0);
            if (v) grid[r.key][day] = v;
          });
        }
      } else {
        // Pre-backfill fallback: compute the funnel rows from the People list, the
        // same cumulative-milestone way the backfill and the live path do.
        PEOPLE.forEach(function (p) {
          if (!countedPerson(p)) return;
          var first = istDay(p.firstSeen);
          var lastView = istDay(p.viewedAt) || first;
          var nv = (p.viewed || []).length;
          bump('visitors', first);
          if (nv >= 1) bump('p1', first);
          if (nv >= 2) bump('p2', lastView);
          if (nv >= 3) bump('p3', lastView);
          bump('cart', istDay(p.cartAt));
          bump('phone', istDay(p.phoneAt));
          bump('address', istDay(p.addressAt));
        });
      }
      visibleAbandoned().forEach(function (a) { bump('checkout', istDay(a.createdAt)); });
      visibleOrders().forEach(function (o) {
        if (o.cancelled) return;
        bump('checkout', istDay(o.createdAt)); // an order necessarily attempted checkout
        bump('ordered', istDay(o.createdAt));
      });
      return grid;
    }
    function renderDaily() {
      var body = $('dailyBody'); if (!body) return;
      if (!MONTH) MONTH = currentIstMonth();
      var pick = $('monthPick'); if (pick && pick.value !== MONTH) pick.value = MONTH;
      var n = daysInMonth(MONTH);
      var grid = dailyCounts(MONTH);
      var rows = DAILY_ROWS.concat([
        { key: 'checkout', label: 'Attempted checkout' },
        { key: 'ordered', label: 'Ordered' },
      ]);
      var head = '<tr><th class="ad-daily__lab">Step</th>';
      for (var d = 1; d <= n; d++) head += '<th class="r">' + d + '</th>';
      head += '<th class="r ad-daily__tot">Total</th></tr>';
      var bodyHtml = rows.map(function (r) {
        var cells = '', total = 0;
        for (var i = 1; i <= n; i++) {
          var key = MONTH + '-' + (i < 10 ? '0' + i : i);
          var v = grid[r.key][key] || 0;
          total += v;
          cells += '<td class="r' + (v ? '' : ' ad-daily__z') + '">' + (v || '·') + '</td>';
        }
        return '<tr><td class="ad-daily__lab">' + esc(r.label) + '</td>' + cells +
          '<td class="r ad-daily__tot">' + total + '</td></tr>';
      }).join('');
      // Crawler activity for this month. The headline is the immutable aggregate;
      // the per-name breakdown is from the (recent) People list, so older months
      // may show fewer names than the total.
      var bots = {};
      PEOPLE.forEach(function (p) {
        if (!p.bot) return;
        if (istDay(p.firstSeen).slice(0, 7) !== MONTH) return;
        bots[p.bot] = (bots[p.bot] || 0) + 1;
      });
      var botNames = Object.keys(bots).sort(function (a, b) { return bots[b] - bots[a]; });
      var botMonth = haveFunnelAggregates()
        ? funnelMonthTotal('visitors', MONTH, 'bot_')
        : botNames.reduce(function (s, n) { return s + bots[n]; }, 0);
      var botHtml = (botMonth || botNames.length)
        ? '<div class="ad-panel"><div class="ad-panel__h"><span class="ad-panel__t">Crawlers</span>' +
          '<label class="ad-bottoggle"><input type="checkbox" id="showBots"' + (SHOW_BOTS ? ' checked' : '') +
          ' /> Count them in the grid above</label></div>' +
          '<div class="ad-pad"><p class="ad-note">' + botMonth + ' crawler ' +
          (botMonth === 1 ? 'visit' : 'visits') + ' this month' +
          (botNames.length ? ' · ' + botNames.map(function (n) { return esc(n) + ' ' + bots[n]; }).join(' · ') : '') +
          '</p></div></div>'
        : '';
      body.innerHTML = '<div class="ad-panel"><div class="ad-scroll">' +
        '<table class="ad-table ad-daily"><thead>' + head + '</thead><tbody>' + bodyHtml + '</tbody></table>' +
        '</div></div>' + botHtml +
        '<p class="ad-oppnote">Counted on the day each person first reached that step, in IST' +
        (SHOW_BOTS ? '' : ', excluding crawlers') +
        (SHOW_HIDDEN ? ', including test records' : '') + '. ' +
        'Product-view rows only cover visits since view tracking went live; checkout and orders come from Shopify.' +
        (haveFunnelAggregates() ? '' : ' Showing an estimate from recent visitors — run the funnel backfill to lock in accurate history.') + '</p>';
    }
    function dailyCsv() {
      var n = daysInMonth(MONTH), grid = dailyCounts(MONTH);
      var rows = DAILY_ROWS.concat([
        { key: 'checkout', label: 'Attempted checkout' },
        { key: 'ordered', label: 'Ordered' },
      ]);
      var head = ['Step'];
      for (var d = 1; d <= n; d++) head.push(String(d));
      var lines = [head.join(',')];
      rows.forEach(function (r) {
        var line = ['"' + r.label + '"'];
        for (var i = 1; i <= n; i++) {
          var key = MONTH + '-' + (i < 10 ? '0' + i : i);
          line.push(String(grid[r.key][key] || 0));
        }
        lines.push(line.join(','));
      });
      var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'mir-kash-funnel-' + MONTH + '.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    }
    // Step the month picker by ±1, staying on a valid YYYY-MM.
    function shiftMonth(delta) {
      var y = Number(MONTH.slice(0, 4)), m = Number(MONTH.slice(5, 7)) + delta;
      var d = new Date(y, m - 1, 1);
      MONTH = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      renderDaily();
    }
    // ── Affiliates ────────────────────────────────────────────────────────────
    var SITE = 'https://www.mirkash.com';
    function affLink(slug) { return SITE + '/go/' + slug; }
    // Random code, minus the characters people misread or mistype when a link is
    // read aloud or copied by hand: 0/o, 1/l/i.
    var CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';
    function randomSlug(n) {
      var out = '';
      for (var i = 0; i < (n || 8); i++) out += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
      return out;
    }
    function renderAffiliates(rows) {
      var body = $('affBody'); if (!body) return;
      if (!rows) {
        body.innerHTML = '<div class="ad-panel"><p class="ad-note ad-pad">Affiliates aren’t available yet — add the Firebase service account (<code>FIREBASE_SERVICE_ACCOUNT</code>) in Vercel to unlock this.</p></div>';
        return;
      }
      if (!rows.length) {
        body.innerHTML = '<div class="ad-panel"><p class="ad-note ad-pad">No affiliate links yet. Create one above and send it to the creator — clicks and sales will show up here.</p></div>';
        return;
      }
      var html = rows.map(function (a) {
        var link = affLink(a.slug);
        return '<tr><td class="nm">' + esc(a.label || a.slug) +
            '<div class="sub"><span class="ad-afflink" data-copy="' + esc(link) + '">' + esc(link) + '</span></div></td>' +
          '<td class="r">' + a.clicks + '</td>' +
          '<td class="r">' + a.orders + '</td>' +
          '<td class="r amt">' + esc(inr(String(a.revenue), a.currency)) + '</td>' +
          '<td class="r">' + (a.clicks ? a.conversionRate.toFixed(1) + '%' : '—') + '</td></tr>';
      }).join('');
      var revenue = rows.reduce(function (s, a) { return s + Number(a.revenue || 0); }, 0);
      var cur = (rows[0] && rows[0].currency) || 'INR';
      body.innerHTML = '<div class="ad-panel"><div class="ad-panel__h"><span class="ad-panel__t">Performance</span><span class="ad-chart-sub">' +
        esc(inr(String(revenue), cur)) + ' from ' + rows.length + (rows.length === 1 ? ' link' : ' links') + '</span></div>' +
        '<div class="ad-scroll"><table class="ad-table"><thead><tr><th>Affiliate</th><th class="r">Clicks</th><th class="r">Orders</th><th class="r">Revenue</th><th class="r">Conv.</th></tr></thead><tbody>' + html + '</tbody></table></div></div>';
    }
    // ── Booking prompt (Try at Home / Private Viewing dialog) ─────────────────
    // Counts are impressions: the dialog shows at most once per visit per page kind, so
    // "saw it" ≈ visits that reached it. Closed + went ahead needn't add to 100% — the
    // rest left the page without doing either.
    function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }
    function renderPrompt(p) {
      var body = $('promptBody'); if (!body) return;
      if (!p || !p.all || !p.all.shown) { body.innerHTML = ''; return; }
      var a = p.all;
      var rows = hbarRow('Saw it', String(a.shown), 100, '') +
        hbarRow('Closed it', a.dismiss + ' · ' + pct(a.dismiss, a.shown) + '%', pct(a.dismiss, a.shown), '') +
        hbarRow('Went ahead', a.click + ' · ' + pct(a.click, a.shown) + '%', pct(a.click, a.shown), '');
      var splits = [
        ['Homepage', p.byPage.home], ['Shop All', p.byPage.shop], ['Product pages', p.byPage.product],
        ['Try at Home offer', p.byOffer.tryhome], ['Private Viewing offer', p.byOffer.viewing],
      ].filter(function (x) { return x[1].shown; });
      var max = splits.reduce(function (m, x) { return Math.max(m, x[1].shown); }, 1);
      var splitRows = splits.map(function (x) {
        var c = x[1];
        return hbarRow(x[0], c.shown + ' saw · ' + pct(c.dismiss, c.shown) + '% closed · ' + pct(c.click, c.shown) + '% went ahead', (c.shown / max) * 100, '');
      }).join('');
      body.innerHTML = hbars('Booking prompt', 'last ' + p.days + ' days · went ahead = tapped Book', rows) +
        (splitRows ? hbars('Booking prompt by page and offer', 'saw · closed · went ahead', splitRows) : '');
    }

    // ── Cart "Before you go" panel ────────────────────────────────────────────
    // Reasons are a share of everyone who saw it; follow-ups are a share of those who
    // picked the answer that leads to them (book: see it / size, number: just looking).
    function renderCartExit(cx) {
      var body = $('cartExitBody'); if (!body) return;
      var c = cx && cx.counts;
      if (!c || !c.cx_shown) { body.innerHTML = ''; return; }
      var shown = c.cx_shown;
      function share(label, n, d) { return hbarRow(label, n + ' · ' + pct(n, d) + '%', pct(n, d), ''); }
      var why = hbarRow('Saw it', String(shown), 100, '') +
        share('Want to see it in person', c.cx_reason_seeit, shown) +
        share('Unsure about size or colour', c.cx_reason_size, shown) +
        share('More than planned', c.cx_reason_price, shown) +
        share('Just looking', c.cx_reason_looking, shown) +
        share('Closed without answering', c.cx_dismiss, shown);
      var next = share('Went to book a viewing', c.cx_book_click, c.cx_reason_seeit + c.cx_reason_size) +
        share('Left a number', c.cx_saved, c.cx_reason_looking) +
        share('Continued to checkout', c.cx_checkout_click, shown);
      body.innerHTML = hbars('Why people leave the cart', 'last ' + cx.days + ' days · share of everyone who saw it', why) +
        hbars('What they did next', '', next);
    }

    // ── Try at Home page: where people drop off ───────────────────────────────
    // Each step counts a browser at most once a day, so these are daily unique
    // visitors. Every row is a share of those who opened the page; the gap between
    // two rows is the drop-off at that step.
    var TAH_STEPS = [
      ['th_view', 'Opened the page'],
      ['th_datetime', 'Chose pieces'],
      ['th_details', 'Chose day and time'],
      ['th_phone', 'Entered phone'],
      ['th_submit', 'Pressed confirm'],
      ['th_booked', 'Booked'],
    ];
    function renderTryAtHomeFunnel(t) {
      var body = $('tahFunnelBody'); if (!body) return;
      if (!t || !t.all || !t.all.th_view) {
        body.innerHTML = '<p class="ad-note ad-pad">No Try at Home page visits counted yet. Counting starts with the new page.</p>';
        return;
      }
      function steps(c) {
        var base = c.th_view;
        return TAH_STEPS.map(function (s, i) {
          var n = c[s[0]] || 0;
          var prev = i ? (c[TAH_STEPS[i - 1][0]] || 0) : 0;
          var lost = i && prev > n ? ' · ' + (prev - n) + ' left' : '';
          return hbarRow(s[1], n + ' · ' + pct(n, base) + '%' + lost, pct(n, base), '');
        }).join('');
      }
      var html = hbars('Try at Home page', 'last ' + t.days + ' days · unique visitors a day · "left" = stopped at the step before', steps(t.all));
      if (t.ad && t.ad.th_view) html += hbars('From Meta ads', 'same steps, ad visitors only', steps(t.ad));
      var days = (t.daily || []).slice(0, 14);
      if (days.length) {
        html += '<div class="ad-panel"><div class="ad-panel__h"><span class="ad-panel__t">Day by day</span></div><div class="ad-scroll"><table class="ad-table"><thead><tr><th>Day</th>' +
          TAH_STEPS.map(function (s) { return '<th class="r">' + esc(s[1]) + '</th>'; }).join('') +
          '<th class="r">Booking rate</th></tr></thead><tbody>' +
          days.map(function (d) {
            return '<tr><td>' + esc(d.day) + '</td>' +
              TAH_STEPS.map(function (s) { return '<td class="r">' + (d.all[s[0]] || 0) + '</td>'; }).join('') +
              '<td class="r">' + pct(d.all.th_booked || 0, d.all.th_view) + '%</td></tr>';
          }).join('') + '</tbody></table></div></div>';
      }
      body.innerHTML = html;
    }

    // ── Phone banner A/B test (src/lib/ab-test.ts) ────────────────────────────
    // A = banner, B = no banner, phone visitors only. The verdict is worked out on the
    // server; this lays out the counts behind it.
    function renderBannerTest(t) {
      var body = $('bannerTestBody'); if (!body) return;
      if (!t) {
        body.innerHTML = '<div class="ad-panel"><div class="ad-panel__h"><span class="ad-panel__t">Phone banner test</span></div>' +
          '<p class="ad-note ad-pad">Running from the next deploy. Results appear here once phone visitors arrive.</p></div>';
        return;
      }
      function rate(n, d) { return d ? (Math.round((n / d) * 1000) / 10) + '%' : '—'; }
      function row(label, c) {
        return '<tr><td class="nm">' + esc(label) + '</td><td class="r">' + c.th_view + '</td>' +
          '<td class="r">' + c.th_datetime + ' · ' + rate(c.th_datetime, c.th_view) + '</td>' +
          '<td class="r">' + c.th_phone + ' · ' + rate(c.th_phone, c.th_view) + '</td>' +
          '<td class="r">' + c.th_booked + ' · ' + rate(c.th_booked, c.th_view) + '</td></tr>';
      }
      var v = t.verdict;
      var cls = v.call === 'B' || v.call === 'A' ? ' ad-abv--win' : v.call === 'stop_B' ? ' ad-abv--stop' : '';
      body.innerHTML = '<div class="ad-panel"><div class="ad-panel__h"><span class="ad-panel__t">Phone banner test</span>' +
        '<span class="ad-chart-sub">since ' + esc(t.firstDay) + ' · day ' + t.days + ' · phone visitors only</span></div>' +
        '<p class="ad-abv' + cls + '">' + esc(v.text) + '</p>' +
        '<div class="ad-scroll"><table class="ad-table"><thead><tr><th>Version</th><th class="r">Visitors</th><th class="r">Chose pieces</th><th class="r">Entered phone</th><th class="r">Booked</th></tr></thead><tbody>' +
        row('A · banner', t.A) + row('B · no banner', t.B) + '</tbody></table></div>' +
        '<p class="ad-note ad-pad">Judged on "chose pieces". A result is called after ' + t.minPerArm + ' visitors in each version and ' + t.minDays +
        ' days, unless B is clearly losing bookings sooner. z = ' + v.pieces.z.toFixed(2) + ' (pieces), ' + v.bookings.z.toFixed(2) + ' (bookings); beyond ±1.96 is a real difference.</p></div>';
    }
    // ── Fulfilment & payments ─────────────────────────────────────────────────
    function fmtDelivery(s) {
      s = String(s || '').toUpperCase();
      var map = { IN_TRANSIT: 'In transit', OUT_FOR_DELIVERY: 'Out for delivery', ATTEMPTED_DELIVERY: 'Delivery attempted', READY_FOR_PICKUP: 'Ready for pickup', PICKED_UP: 'Picked up', DELIVERED: 'Delivered', LABEL_PRINTED: 'Label printed', LABEL_PURCHASED: 'Label ready' };
      return map[s] || (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '');
    }
    function fmtFinancial(s) {
      s = String(s || '').toUpperCase();
      var map = { PENDING: 'Payment pending', AUTHORIZED: 'Authorised — not captured', PARTIALLY_PAID: 'Partially paid', PARTIALLY_REFUNDED: 'Partially refunded', REFUNDED: 'Refunded', VOIDED: 'Voided', PAID: 'Paid' };
      return map[s] || (s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '—');
    }
    function opsRows(rows, kind) {
      return rows.map(function (o) {
        var tel = (o.phone || '').replace(/[^0-9]/g, '');
        var status;
        if (kind === 'payment') status = '<span class="ad-pill ad-pill--wait">' + esc(fmtFinancial(o.financial)) + '</span>';
        else if (kind === 'transit') { var eta = o.etaAt ? ' · ETA ' + when(o.etaAt) : ''; status = '<span class="ad-pill ad-pill--good">' + esc((fmtDelivery(o.deliveryStatus) || 'In transit') + eta) + '</span>'; }
        else if (kind === 'delivered') { var dt = o.deliveredAt || o.fulfilledAt; status = '<span class="ad-pill ad-pill--done">' + esc((o.deliveredAt ? 'Delivered' : 'Fulfilled') + (dt ? ' · ' + when(dt) : '')) + '</span>'; }
        else status = '<span class="ad-pill ad-pill--wait">To fulfil</span>';
        var acts = [];
        if (kind === 'payment' && tel) acts.push('<a class="ad-link" href="https://wa.me/' + tel + '" target="_blank" rel="noopener">Chase</a>');
        if (o.adminUrl) acts.push('<a class="ad-link" href="' + esc(o.adminUrl) + '" target="_blank" rel="noopener">Open →</a>');
        return '<tr><td class="nm">' + esc(o.customer || 'Guest') + (o.phone ? '<div class="sub">' + esc(o.phone) + '</div>' : '') + '</td><td>' + esc(o.name) + '</td><td>' + esc(o.items || '—') + '</td><td>' + when(o.createdAt) + '</td><td class="r amt">' + esc(inr(o.total && o.total.amount, o.total && o.total.currencyCode)) + '</td><td>' + status + '</td><td class="r">' + acts.join(' ') + '</td></tr>';
      }).join('');
    }
    function opsPanel(title, count, rowsHtml, emptyMsg) {
      return '<div class="ad-panel"><div class="ad-panel__h"><span class="ad-panel__t">' + esc(title) + '</span><span class="ad-chart-sub">' + count + (count === 1 ? ' order' : ' orders') + '</span></div>' +
        (rowsHtml
          ? '<div class="ad-scroll"><table class="ad-table"><thead><tr><th>Customer</th><th>Order</th><th>Items</th><th>Date</th><th class="r">Total</th><th>Status</th><th></th></tr></thead><tbody>' + rowsHtml + '</tbody></table></div>'
          : '<p class="ad-note ad-pad">' + esc(emptyMsg) + '</p>') + '</div>';
    }
    function renderFulfilment(orders) {
      var body = $('fulfilBody');
      if (!body) return;
      var live = orders.filter(function (o) { return !o.cancelled; });
      var transit = ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'ATTEMPTED_DELIVERY', 'READY_FOR_PICKUP'];
      var inTransit = live.filter(function (o) { return transit.indexOf(String(o.deliveryStatus || '').toUpperCase()) > -1; });
      var toFulfil = live.filter(function (o) {
        var f = String(o.fulfillment || '').toUpperCase();
        var unshipped = (f === '' || f === 'UNFULFILLED' || f === 'PARTIALLY_FULFILLED' || f === 'PENDING_FULFILLMENT' || f === 'OPEN' || f === 'IN_PROGRESS' || f === 'ON_HOLD' || f === 'SCHEDULED');
        return unshipped && inTransit.indexOf(o) === -1;
      });
      var payPending = live.filter(function (o) {
        return ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID'].indexOf(String(o.financial || '').toUpperCase()) > -1;
      });
      var doneDate = function (o) { return new Date(o.deliveredAt || o.fulfilledAt || o.createdAt).getTime(); };
      var fulfilled = live.filter(function (o) { return String(o.fulfillment || '').toUpperCase() === 'FULFILLED' || o.deliveredAt; })
        .sort(function (a, b) { return doneDate(b) - doneDate(a); });
      body.innerHTML =
        opsPanel('Orders to fulfil', toFulfil.length, opsRows(toFulfil, 'fulfil'), 'Nothing waiting to be fulfilled — you’re all caught up.') +
        opsPanel('In transit / out for delivery', inTransit.length, opsRows(inTransit, 'transit'), 'No shipments in transit. This fills in when you fulfil orders with a tracking number in Shopify.') +
        opsPanel('Fulfilled &amp; delivered', fulfilled.length, opsRows(fulfilled, 'delivered'), 'No fulfilled orders yet.') +
        opsPanel('Payments pending', payPending.length, opsRows(payPending, 'payment'), 'No pending payments — everything is paid.');
      var ids = {};
      toFulfil.concat(payPending).forEach(function (o) { ids[o.id] = 1; });
      FULFIL_PENDING = Object.keys(ids).length;
    }

    // ── Revenue insights (charts) ─────────────────────────────────────────────
    function money0(n, cur) { return inr(String(Math.round(Number(n) || 0)), cur || 'INR'); }
    function niceCeil(v) {
      if (v <= 0) return 0;
      var pow = Math.pow(10, Math.floor(Math.log(v) / Math.LN10));
      var n = v / pow;
      var nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
      return nice * pow;
    }
    function revTiles(list) {
      return '<div class="ad-kpis ad-kpis--rev">' + list.map(function (x) {
        return '<div class="ad-kpi"><span class="ad-kpi__n">' + esc(x.n) + '</span><span class="ad-kpi__k">' + esc(x.k) + '</span>' + (x.d ? '<span class="ad-kpi__d">' + esc(x.d) + '</span>' : '') + '</div>';
      }).join('') + '</div>';
    }
    function dailyChart(days, cur) {
      var W = 720, H = 240, padL = 6, padR = 6, padT = 16, padB = 24;
      var plotW = W - padL - padR, plotH = H - padT - padB;
      var max = niceCeil(Math.max.apply(null, days.map(function (d) { return d.amount; }).concat([1])));
      var n = days.length, step = plotW / n, gap = Math.min(4, step * 0.25), bw = Math.max(step - gap, 1);
      var bars = days.map(function (d, i) {
        var h = max ? (d.amount / max) * plotH : 0;
        var x = padL + i * step, y = padT + plotH - h;
        var lbl = d.label.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
        return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(h, 0).toFixed(1) + '" rx="2" class="ad-barrect"><title>' + esc(lbl + ' — ' + (d.amount ? money0(d.amount, cur) : 'no sales')) + '</title></rect>';
      }).join('');
      var grid = [0, 0.5, 1].map(function (f) {
        var y = padT + plotH - f * plotH;
        return '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" class="ad-grid"/>' +
          '<text x="' + padL + '" y="' + (y - 4).toFixed(1) + '" class="ad-glabel">' + esc(money0(max * f, cur)) + '</text>';
      }).join('');
      var xl = [0, Math.floor(n / 2), n - 1].map(function (i) {
        var x = padL + i * step + bw / 2;
        var anchor = i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle');
        return '<text x="' + x.toFixed(1) + '" y="' + (H - 7) + '" class="ad-xlabel" text-anchor="' + anchor + '">' + esc(days[i].label.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })) + '</text>';
      }).join('');
      return '<div class="ad-panel ad-chartcard"><div class="ad-chart-h"><span class="ad-panel__t">Revenue — last 30 days</span><span class="ad-chart-sub">hover a bar for the day</span></div>' +
        '<div class="ad-chartwrap"><svg viewBox="0 0 ' + W + ' ' + H + '" class="ad-svg" role="img" aria-label="Daily revenue for the last 30 days">' + grid + bars + xl + '</svg></div></div>';
    }
    function hbars(title, sub, rows) {
      if (!rows) return '';
      return '<div class="ad-panel ad-chartcard"><div class="ad-chart-h"><span class="ad-panel__t">' + esc(title) + '</span>' + (sub ? '<span class="ad-chart-sub">' + esc(sub) + '</span>' : '') + '</div><div class="ad-hbars">' + rows + '</div></div>';
    }
    function hbarRow(name, valText, pct, cls) {
      return '<div class="ad-hbar"><span class="ad-hbar__name">' + esc(name) + '</span>' +
        '<span class="ad-hbar__track"><span class="ad-hbar__fill ' + (cls || '') + '" style="width:' + Math.max(pct, 2).toFixed(1) + '%"></span></span>' +
        '<span class="ad-hbar__val">' + esc(valText) + '</span></div>';
    }
    function renderRevenue(orders, abandoned) {
      var body = $('revenueBody');
      if (!body) return;
      var now = Date.now(), DAY = 864e5;
      var cur = (orders[0] && orders[0].total && orders[0].total.currencyCode) || 'INR';
      var live = orders.filter(function (o) { return !o.cancelled; });
      var in30 = live.filter(function (o) { var t = new Date(o.createdAt).getTime(); return isFinite(t) && now - t <= 30 * DAY; });
      var rev30 = in30.reduce(function (s, o) { return s + Number((o.total && o.total.amount) || 0); }, 0);
      var aov = in30.length ? rev30 / in30.length : 0;
      var pending = live.filter(function (o) { return String(o.financial || '').toUpperCase() !== 'PAID'; }).length;
      var abVal = (abandoned || []).reduce(function (s, a) { return s + Number((a.total && a.total.amount) || 0); }, 0);

      var start = new Date(); start.setHours(0, 0, 0, 0);
      var days = [];
      for (var i = 29; i >= 0; i--) { var d = new Date(start.getTime() - i * DAY); days.push({ t: d.getTime(), label: d, amount: 0 }); }
      in30.forEach(function (o) {
        var t = new Date(o.createdAt); t.setHours(0, 0, 0, 0);
        for (var j = 0; j < days.length; j++) { if (days[j].t === t.getTime()) { days[j].amount += Number((o.total && o.total.amount) || 0); break; } }
      });

      var bagMap = {};
      live.forEach(function (o) {
        String(o.items || '').split(',').forEach(function (part) {
          var m = part.trim().match(/^(\d+)\s*[^\w\s]?\s*(.+)$/);
          if (m) { var nm = m[2].trim(); bagMap[nm] = (bagMap[nm] || 0) + parseInt(m[1], 10); }
        });
      });
      var bags = Object.keys(bagMap).map(function (k) { return { name: k, qty: bagMap[k] }; }).sort(function (a, b) { return b.qty - a.qty; }).slice(0, 6);
      var bagMax = bags.length ? bags[0].qty : 1;

      if (!live.length) { body.innerHTML = '<div class="ad-panel"><p class="ad-note ad-pad">No orders yet to chart.</p></div>'; return; }

      var oppMax = Math.max(rev30, abVal, 1);
      body.innerHTML =
        revTiles([
          { n: money0(rev30, cur), k: 'Revenue · 30 days', d: in30.length + ' orders' },
          { n: money0(aov, cur), k: 'Avg order value', d: '' },
          { n: money0(abVal, cur), k: 'Abandoned value', d: 'at risk' },
          { n: String(pending), k: 'Awaiting payment', d: 'of ' + live.length + ' orders' },
        ]) +
        dailyChart(days, cur) +
        hbars('Best-selling bags', 'by units sold (recent orders)', bags.map(function (b) { return hbarRow(b.name, b.qty + (b.qty === 1 ? ' unit' : ' units'), (b.qty / bagMax) * 100, ''); }).join('')) +
        hbars('Captured vs. left behind', 'last 30 days', hbarRow('Captured revenue', money0(rev30, cur), (rev30 / oppMax) * 100, 'ad-fill--good') + hbarRow('Abandoned carts', money0(abVal, cur), (abVal / oppMax) * 100, 'ad-fill--warn')) +
        '<p class="ad-oppnote">' + esc(money0(abVal, cur)) + ' is sitting in abandoned checkouts — reach those customers from the Abandoned tab to recover it.</p>';
    }

    function rerender() { if (LAST_DATA) renderOps(LAST_DATA); }
    var FIRST_PAINT_DONE = false;
    // Paint every operations view from one /api/admin/data payload.
    function renderOps(data) {
      LAST_DATA = data;
      setLegacy(data);
      ORDERS = data.orders || [];
      ABANDONED = data.abandoned || [];
      FUNNEL_DAILY = data.funnelDaily || {};
      DEMOS = data.demos || [];
      VIEWINGS = data.viewings || [];
      PEOPLE = data.people || [];
      AFFILIATES = data.affiliates || [];
      SUBSCRIBERS = ('subscribers' in data) ? data.subscribers : [];
      var orders = visibleOrders();
      var abandoned = visibleAbandoned();
      $('ovOrders') && ($('ovOrders').innerHTML = ordersTable(orders.slice(0, 8)));
      $('allOrders').innerHTML = ordersTable(orders);
      $('allDemos').innerHTML = demosTable(DEMOS);
      $('allViewings').innerHTML = viewingsTable(VIEWINGS);
      $('allSubs').innerHTML = subscribersTable(SUBSCRIBERS);
      renderRevenue(orders, abandoned);
      renderFulfilment(orders);
      renderPrompt(data.prompt);
      renderCartExit(data.cartExit);
      renderTryAtHomeFunnel(data.tryAtHome);
      renderBannerTest(data.bannerTest);
      renderAffiliates(data.affiliates);
      renderDaily();
      renderBadges(); // after renderFulfilment, which computes the pending count
      stampUpdated();
      if (!FIRST_PAINT_DONE) { FIRST_PAINT_DONE = true; }
    }
    // The restricted 'affiliate' role's entire dashboard: just the Affiliates view, fed
    // only by /api/admin/affiliate — no other section has data to draw.
    function renderAffiliateOnly(rows) {
      AFFILIATES = rows || [];
      renderAffiliates(AFFILIATES);
      stampUpdated();
    }
    function stampUpdated() {
      var el = $('updated'); if (!el) return;
      try { el.textContent = 'Loaded ' + new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); } catch (e) {}
    }
    // Daily funnel: month stepper, direct picker, and CSV export.
    $('monthPrev').addEventListener('click', function () { shiftMonth(-1); });
    $('monthNext').addEventListener('click', function () { shiftMonth(1); });
    $('monthPick').addEventListener('change', function (e) {
      if (e.target.value) { MONTH = e.target.value; renderDaily(); }
    });
    $('monthCsv').addEventListener('click', dailyCsv);
    $('newsCsv').addEventListener('click', newsletterCsv);
    // Delegated: the toggle is re-created on every grid render. Both toggles change
    // what's counted everywhere, so re-render the whole dashboard from the last payload.
    $('dailyBody').addEventListener('change', function (e) {
      if (e.target && e.target.id === 'showBots') { SHOW_BOTS = e.target.checked; rerender(); }
    });
    // Affiliates: create a link, and click any link to copy it.
    function affMsg(t, bad) {
      var el = $('affMsg'); if (!el) return;
      el.textContent = t || '';
      el.classList.toggle('is-bad', !!bad);
    }
    $('affGen').addEventListener('click', function () {
      $('affSlug').value = randomSlug(8);
      affMsg('');
      $('affSlug').focus();
    });
    $('affForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var slug = ($('affSlug').value || '').trim().toLowerCase();
      if (!slug) { affMsg('Give the link a name first.', true); return; }
      var btn = $('affCreate'); btn.disabled = true; affMsg('Creating…');
      var headers = await authHeaders();
      if (!headers) { affMsg('Session expired — reload and sign in again.', true); btn.disabled = false; return; }
      headers['Content-Type'] = 'application/json';
      try {
        var resp = await fetch('/api/admin/affiliate', {
          method: 'POST', headers: headers,
          body: JSON.stringify({ slug: slug, label: ($('affLabel').value || '').trim() }),
        });
        var res = await resp.json().catch(function () { return null; });
        if (!resp.ok || !res || !res.ok) { affMsg((res && res.error) || 'Could not create the link.', true); btn.disabled = false; return; }
        $('affSlug').value = ''; $('affLabel').value = '';
        affMsg('Created ' + affLink(res.slug) + ' — click it below to copy.');
        // Re-fetch just the affiliates list (works for both roles), not the whole dashboard.
        var ar = await callAffiliates(headers);
        if (ar.data) { AFFILIATES = ar.data.affiliates || []; renderAffiliates(AFFILIATES); }
      } catch (err) { affMsg('Network error — try again.', true); }
      btn.disabled = false;
    });
    $('affBody').addEventListener('click', function (e) {
      var el = e.target.closest('[data-copy]'); if (!el) return;
      var link = el.getAttribute('data-copy');
      try {
        navigator.clipboard.writeText(link);
        var was = el.textContent;
        el.textContent = 'Copied ✓';
        setTimeout(function () { el.textContent = was; }, 1200);
      } catch (err) { affMsg('Copy failed — select the link manually.', true); }
    });

    // ── Team access (founders-only: who else can sign in, and at what role) ────
    function renderTeam(founders, team) {
      var body = $('teamBody'); if (!body) return;
      var founderRows = (founders || []).map(function (e) {
        return '<tr><td class="nm">' + esc(e) + '<div class="sub">Founder</div></td><td class="r">Full</td><td></td></tr>';
      }).join('');
      var teamRows = (team || []).map(function (u) {
        return '<tr><td class="nm">' + esc(u.label || u.email) + '<div class="sub">' + esc(u.email) + '</div></td>' +
          '<td class="r">' + (u.role === 'full' ? 'Full' : 'Affiliate links only') + '</td>' +
          '<td class="r"><button type="button" class="ad-dbtn" data-remove="' + esc(u.email) + '">Remove</button></td></tr>';
      }).join('');
      if (!founderRows && !teamRows) {
        body.innerHTML = '<div class="ad-panel"><p class="ad-note ad-pad">No one has access yet.</p></div>';
        return;
      }
      body.innerHTML = '<div class="ad-panel"><div class="ad-panel__h"><span class="ad-panel__t">Who has access</span></div>' +
        '<div class="ad-scroll"><table class="ad-table"><thead><tr><th>Person</th><th class="r">Access</th><th></th></tr></thead><tbody>' +
        founderRows + teamRows + '</tbody></table></div></div>';
    }
    async function loadTeam() {
      var headers = await authHeaders();
      if (!headers) return;
      try {
        var resp = await fetch('/api/admin/team', { headers: headers });
        var j = await resp.json().catch(function () { return null; });
        if (resp.ok && j) renderTeam(j.founders, j.team);
      } catch (e) { /* Team access tab just stays empty */ }
    }
    function teamMsg(t, bad) {
      var el = $('teamMsg'); if (!el) return;
      el.textContent = t || '';
      el.classList.toggle('is-bad', !!bad);
    }
    $('teamForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var email = ($('teamEmail').value || '').trim().toLowerCase();
      var role = $('teamRole').value;
      if (!email) { teamMsg('Enter an email first.', true); return; }
      var btn = $('teamCreate'); btn.disabled = true; teamMsg('Granting…');
      var headers = await authHeaders();
      if (!headers) { teamMsg('Session expired — reload and sign in again.', true); btn.disabled = false; return; }
      headers['Content-Type'] = 'application/json';
      try {
        var resp = await fetch('/api/admin/team', {
          method: 'POST', headers: headers,
          body: JSON.stringify({ email: email, role: role }),
        });
        var res = await resp.json().catch(function () { return null; });
        if (!resp.ok || !res || !res.ok) { teamMsg((res && res.error) || 'Could not grant access.', true); btn.disabled = false; return; }
        $('teamEmail').value = '';
        teamMsg('Access granted.');
        loadTeam();
      } catch (err) { teamMsg('Network error — try again.', true); }
      btn.disabled = false;
    });
    $('teamBody').addEventListener('click', async function (e) {
      var b = e.target.closest('[data-remove]'); if (!b) return;
      var email = b.getAttribute('data-remove');
      if (!confirm('Remove dashboard access for ' + email + '?')) return;
      b.disabled = true;
      var headers = await authHeaders();
      if (!headers) return;
      headers['Content-Type'] = 'application/json';
      try {
        var resp = await fetch('/api/admin/team', { method: 'DELETE', headers: headers, body: JSON.stringify({ email: email }) });
        if (resp.ok) loadTeam(); else b.disabled = false;
      } catch (err) { b.disabled = false; }
    });
    // ── Person journey drawer ─────────────────────────────────────────────────
    function addr(a) {
      if (!a) return '<span class="ad-dv">—</span>';
      var lines = [a.name, a.address1, a.address2, [a.city, a.province, a.zip].filter(Boolean).join(', '), a.country].filter(Boolean);
      return lines.map(function (l) { return esc(l); }).join('<br>') || '<span class="ad-dv">—</span>';
    }
    // The Shopify-side breakdown of an unpaid draft — kept intact from the old
    // Abandoned-checkouts view, now shown inside the person it belongs to.
    function abandonedSection(r) {
      var d = r.detail || {};
      var lineRows = (d.lines || []).map(function (l) {
        var unit = inr(l.price && l.price.amount, l.price && l.price.currencyCode);
        var lineTot = l.price ? inr(String(Number(l.price.amount) * l.quantity), l.price.currencyCode) : '—';
        return '<tr><td class="nm">' + esc(l.title) + (l.variant ? '<div class="sub">' + esc(l.variant) + '</div>' : '') + '</td><td class="r">' + l.quantity + ' × ' + esc(unit) + '</td><td class="r amt">' + esc(lineTot) + '</td></tr>';
      }).join('');
      var money = function (label, m, strong) {
        return '<div class="ad-tot' + (strong ? ' ad-tot--strong' : '') + '"><span>' + label + '</span><span>' + esc(m ? inr(m.amount, m.currencyCode) : '—') + '</span></div>';
      };
      return '<div class="ad-dsect"><h3 class="ad-dh3">Unpaid checkout · ' + esc(r.name || '') + '</h3>' +
        '<p class="ad-dmeta">Started ' + when(r.createdAt, true) + ' — never paid.</p>' +
        (d.address ? '<p class="ad-daddr">' + addr(d.address) + '</p>' : '') +
        '<table class="ad-dtable"><tbody>' + (lineRows || '<tr><td class="ad-dv">No items</td></tr>') + '</tbody></table>' +
        '<div class="ad-tots">' + money('Subtotal', d.subtotal) + money('Shipping', d.shipping) + money('Total', d.total, true) + '</div>' +
        (d.adminUrl ? '<div class="ad-dactions"><a class="ad-dbtn ad-dbtn--fill" href="' + esc(d.adminUrl) + '" target="_blank" rel="noopener">Open draft in Shopify →</a></div>' : '') +
        '</div>';
    }
    var STEP_LABEL = { first_seen: 'Visited the site', cart: 'Added to bag', phone: 'Entered phone', address: 'Entered address' };
    function timeline(steps) {
      if (!steps || !steps.length) return '<p class="ad-note">No journey recorded yet.</p>';
      return '<ol class="ad-tl">' + steps.map(function (s) {
        return '<li class="ad-tl__i ad-tl__i--' + esc(s.type) + '">' +
          '<span class="ad-tl__when">' + when(s.at, true) + '</span>' +
          '<span class="ad-tl__what">' + esc(STEP_LABEL[s.type] || s.type) + '</span>' +
          (s.detail ? '<span class="ad-tl__d">' + esc(s.detail) + '</span>' : '') +
          '</li>';
      }).join('') + '</ol>';
    }
    function buildPersonDrawer(p, steps, loading) {
      var tel = (p.phone || '').replace(/[^0-9]/g, '');
      var actions = [];
      if (tel) actions.push('<a class="ad-dbtn ad-dbtn--fill" href="https://wa.me/' + tel + '" target="_blank" rel="noopener">WhatsApp</a>');
      if (tel) actions.push('<a class="ad-dbtn" href="tel:+' + tel + '">Call</a>');
      if (p.email) actions.push('<a class="ad-dbtn" href="mailto:' + esc(p.email) + '">Email</a>');
      var bagRows = (p.cart && p.cart.lines && p.cart.lines.length)
        ? p.cart.lines.map(function (l) {
            return '<tr><td class="nm">' + esc(l.title) + (l.variant ? '<div class="sub">' + esc(l.variant) + '</div>' : '') +
              '</td><td class="r">' + l.quantity + ' × ' + esc(inr(String(l.price), p.cartCurrency)) + '</td>' +
              '<td class="r amt">' + esc(inr(String(l.price * l.quantity), p.cartCurrency)) + '</td></tr>';
          }).join('')
        : '';
      // Acquisition + behaviour: how they found us, what they browsed, how they buy.
      var facts = [];
      if (p.bot) facts.push(['Crawler', p.bot]);
      if (p.sourceLabel) facts.push(['Came from', p.sourceLabel]);
      if (p.country) facts.push(['Country', p.country]);
      if (p.landing) facts.push(['Landed on', p.landing]);
      if (p.viewed && p.viewed.length) {
        facts.push(['Products viewed', String(p.viewed.length)]);
        if (p.lastViewed) facts.push(['Last viewed', p.lastViewed]);
      }
      if (p.pageViews) {
        facts.push(['Pages viewed', p.pageViews + ((p.pages || []).length > 1 ? ' (' + p.pages.length + ' unique)' : '')]);
      }
      if (p.orderCount > 1) facts.push(['Orders', p.orderCount + ' · repeat buyer']);
      if (p.lifetimeValue) facts.push(['Lifetime value', inr(String(p.lifetimeValue), p.cartCurrency)]);
      if (p.daysToPurchase !== null && p.daysToPurchase !== undefined) {
        facts.push(['Time to purchase', p.daysToPurchase === 0 ? 'Same day' :
          p.daysToPurchase + (p.daysToPurchase === 1 ? ' day' : ' days')]);
      }
      var factsHtml = facts.length
        ? '<div class="ad-dsect"><h3 class="ad-dh3">Acquisition &amp; behaviour</h3><dl class="ad-dfacts">' +
          facts.map(function (f) { return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join('') +
          '</dl></div>'
        : '';
      // Everything they opened but never bagged — the clearest "what to nudge" signal.
      var bagged = {};
      (p.items || []).forEach(function (t) { bagged[t] = 1; });
      var browsedOnly = (p.viewed || []).filter(function (t) { return !bagged[t]; });
      var browsedHtml = browsedOnly.length
        ? '<div class="ad-dsect"><h3 class="ad-dh3">Viewed but not bagged</h3><p class="ad-daddr">' +
          esc(browsedOnly.join(', ')) + '</p></div>'
        : '';
      // Every distinct page they opened. Products are listed above by name, so this
      // is mostly the non-product path — home, shop, story, care, checkout.
      var pagesHtml = (p.pages && p.pages.length)
        ? '<div class="ad-dsect"><h3 class="ad-dh3">Pages visited</h3><ul class="ad-dpages">' +
          p.pages.map(function (pg) {
            return '<li>' + esc(pg) + (pg === p.landing ? '<span class="ad-tag">landed here</span>' : '') + '</li>';
          }).join('') + '</ul></div>'
        : '';
      return '' +
        '<div class="ad-dhead">' + stagePill(p.stage) +
          '<h2 class="ad-display ad-dtitle">' + esc(p.name || 'Visitor') + '</h2>' +
          '<p class="ad-dmeta">' + esc([p.phone, p.email].filter(Boolean).join(' · ') || '—') + '</p>' +
          '<p class="ad-dmeta">' + p.visits + (p.visits === 1 ? ' session' : ' sessions') + ' · first seen ' + when(p.firstSeen, true) +
            (p.source === 'legacy-checkout' ? ' · <span class="ad-tag">from earlier checkout capture</span>' : '') + '</p>' +
        '</div>' +
        (actions.length ? '<div class="ad-dactions">' + actions.join('') + '</div>' : '') +
        bookingSection(p.booking) +
        factsHtml +
        (p.address ? '<div class="ad-dsect"><h3 class="ad-dh3">Delivery address</h3><p class="ad-daddr">' + esc(p.address) + '</p></div>' : '') +
        browsedHtml +
        pagesHtml +
        (bagRows
          ? '<div class="ad-dsect"><h3 class="ad-dh3">Their bag</h3><table class="ad-dtable"><tbody>' + bagRows + '</tbody></table>' +
            '<div class="ad-tots"><div class="ad-tot ad-tot--strong"><span>Bag value</span><span>' + esc(inr(String(p.cartValue), p.cartCurrency)) + '</span></div></div></div>'
          : '') +
        (p.abandoned ? abandonedSection(p.abandoned) : '') +
        '<div class="ad-dsect"><h3 class="ad-dh3">Journey</h3>' +
          (loading ? '<p class="ad-note">Loading…</p>' : timeline(steps)) + '</div>';
    }
    function bookingSection(b) {
      if (!b) return '';
      var facts = [['Status', bookingStatus(b)]];
      var pieces = bookingPieces(b);
      if (pieces) facts.push(['Pieces', pieces]);
      if (b.date) facts.push(['Day', bookingDay(b)]);
      if (b.slot) facts.push(['Time', b.slot]);
      if (b.at) facts.push(['Last step', when(b.at, true)]);
      return '<div class="ad-dsect"><h3 class="ad-dh3">' + esc(bookingFlowName(b)) + '</h3><dl class="ad-dfacts">' +
        facts.map(function (f) { return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join('') +
        '</dl></div>';
    }
    // Open a person: paint what we already have, then fill in the stitched timeline.
    async function openLegacyPerson(id) {
      var p = PEOPLE.filter(function (x) { return x.id === id; })[0]; if (!p) return;
      $('drawerBody').innerHTML = buildPersonDrawer(p, null, true);
      $('drawerBody').scrollTop = 0;
      openDrawerShell();
      var steps = [];
      try {
        var headers = await authHeaders();
        if (headers) {
          var resp = await fetch('/api/admin/journey?id=' + encodeURIComponent(p.id), { headers: headers });
          if (resp.ok) steps = (await resp.json()).steps || [];
        }
      } catch (e) { /* show what we have */ }
      if (!$('drawer').hidden) $('drawerBody').innerHTML = buildPersonDrawer(p, steps, false);
    }
    // ── Home-demo detail + confirm/complete ───────────────────────────────────
    function fmtISO(iso) {
      if (!iso) return '';
      try { return new Date(iso + 'T00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); }
      catch (e) { return iso; }
    }
    function fmt12(t) {
      if (!t) return '';
      var p = String(t).split(':'); var h = parseInt(p[0], 10); var m = p[1] || '00';
      if (isNaN(h)) return t;
      var ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
      return h + ':' + m + ' ' + ap;
    }
    function confirmMsg(r) {
      var name = (r.customer || 'there').split(' ')[0];
      var d = fmtISO(r.confirmedDate), t = fmt12(r.confirmedTime);
      var whenTxt = (d || r.date || '') + (t ? ' at ' + t : (r.slot ? ' (' + r.slot + ')' : ''));
      var subject = 'Your Mir Kash Try at Home is confirmed';
      var body = 'Hi ' + name + ',\n\nYour Mir Kash Try at Home is confirmed for ' + whenTxt + '.\n\n' +
        (r.address ? 'Address: ' + r.address + '\n' : '') +
        (r.bags ? "Bags we'll bring: " + r.bags + '\n' : '') +
        '\nWe look forward to meeting you. Just reply to this email or call us if anything changes.\n\nWarmly,\nMir Kash';
      var wa = 'Hi ' + name + ', your Mir Kash Try at Home is confirmed for ' + whenTxt + '.' +
        (r.address ? ' Address: ' + r.address + '.' : '') + ' See you then! — Mir Kash';
      return { subject: subject, body: body, wa: wa };
    }
    function buildDemoDrawer(r) {
      var status = r.status || 'requested';
      var bagsList = (r.bags || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var telDigits = (r.phone || '').replace(/[^0-9]/g, '');
      var m = confirmMsg(r);
      var notify = '';
      if (r.email) notify += '<a class="ad-dbtn ad-dbtn--fill" href="mailto:' + esc(r.email) + '?subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body) + '">Email confirmation</a>';
      if (telDigits) notify += '<a class="ad-dbtn ad-dbtn--wa" href="https://wa.me/' + telDigits + '?text=' + encodeURIComponent(m.wa) + '" target="_blank" rel="noopener">WhatsApp</a>';

      var actionSect;
      if (status === 'requested') {
        actionSect =
          '<div class="ad-dsect ad-dact"><h3 class="ad-dh3">Confirm this Try at Home</h3>' +
          '<p class="ad-reqnote">Requested: ' + esc(r.date || '—') + (r.slot ? ' · ' + esc(r.slot) : '') + '</p>' +
          '<div class="ad-form"><label class="ad-flabel">Date<input class="ad-finput" type="date" id="demoDate"></label>' +
          '<label class="ad-flabel">Time<input class="ad-finput" type="time" id="demoTime"></label></div>' +
          '<button class="ad-dbtn ad-dbtn--fill ad-dbtn--wide" id="demoConfirm" type="button">Confirm booking</button>' +
          '<p class="ad-actmsg" id="demoMsg"></p></div>';
      } else if (status === 'confirmed') {
        actionSect =
          '<div class="ad-dsect ad-dact"><h3 class="ad-dh3">Confirmed for</h3>' +
          '<p class="ad-confirmed">' + esc(fmtISO(r.confirmedDate)) + ' · ' + esc(fmt12(r.confirmedTime)) + '</p>' +
          '<p class="ad-note ad-notifynote">Send the customer their confirmation:</p>' +
          '<div class="ad-dactions">' + notify + '</div>' +
          '<button class="ad-dbtn ad-dbtn--wide" id="demoComplete" type="button">Mark Try at Home complete</button>' +
          '<p class="ad-actmsg" id="demoMsg"></p></div>';
      } else {
        actionSect =
          '<div class="ad-dsect ad-dact"><h3 class="ad-dh3">Try at Home completed</h3>' +
          '<p class="ad-confirmed">' + (r.confirmedDate ? esc(fmtISO(r.confirmedDate)) + (r.confirmedTime ? ' · ' + esc(fmt12(r.confirmedTime)) : '') : 'Marked complete') + '</p>' +
          (notify ? '<div class="ad-dactions">' + notify + '</div>' : '') + '</div>';
      }

      var footer = [];
      if (r.adminUrl) footer.push('<a class="ad-dbtn" href="' + esc(r.adminUrl) + '" target="_blank" rel="noopener">Open in Shopify →</a>');
      if (telDigits) footer.push('<a class="ad-dbtn" href="tel:+' + telDigits + '">Call</a>');

      return '' +
        '<div class="ad-dhead">' + demoPill(status) +
          '<h2 class="ad-display ad-dtitle">' + esc(r.customer || 'Guest') + '</h2>' +
          '<p class="ad-dmeta">' + esc(r.name) + ' · Booked ' + when(r.createdAt) + '</p>' +
        '</div>' +
        actionSect +
        '<div class="ad-dsect"><h3 class="ad-dh3">Contact</h3>' +
          '<div class="ad-drow"><span class="ad-dk">Email</span><span class="ad-dvv">' + (r.email ? esc(r.email) : '<span class="ad-dv">—</span>') + '</span></div>' +
          '<div class="ad-drow"><span class="ad-dk">Phone</span><span class="ad-dvv">' + (r.phone ? esc(r.phone) : '<span class="ad-dv">—</span>') + '</span></div>' +
        '</div>' +
        '<div class="ad-dsect"><h3 class="ad-dh3">Requested slot</h3><p class="ad-daddr">' + esc(r.date || '—') + (r.slot ? '<br>' + esc(r.slot) : '') + '</p></div>' +
        '<div class="ad-dsect"><h3 class="ad-dh3">Bags to show</h3>' + (bagsList.length ? '<ul class="ad-baglist">' + bagsList.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' : '<p class="ad-dv">—</p>') + '</div>' +
        '<div class="ad-dsect"><h3 class="ad-dh3">Address</h3><p class="ad-daddr">' + (r.address ? esc(r.address) : '<span class="ad-dv">—</span>') + '</p></div>' +
        (footer.length ? '<div class="ad-dactions">' + footer.join('') + '</div>' : '');
    }
    function demoMsg(t) { var el = $('demoMsg'); if (el) el.textContent = t || ''; }
    async function doDemoAction(idx, payload, btn) {
      var r = DEMOS[idx]; if (!r) return;
      demoMsg('Saving…'); if (btn) btn.disabled = true;
      var headers = await authHeaders();
      if (!headers) { demoMsg('Session expired — reload and sign in again.'); if (btn) btn.disabled = false; return; }
      headers['Content-Type'] = 'application/json';
      try {
        var resp = await fetch('/api/admin/demo', { method: 'POST', headers: headers, body: JSON.stringify(Object.assign({ id: r.id }, payload)) });
        var res = await resp.json().catch(function () { return null; });
        if (!resp.ok || !res || !res.ok) { demoMsg((res && res.error) || 'Could not save — try again.'); if (btn) btn.disabled = false; return; }
        if (payload.action === 'confirm') { r.status = 'confirmed'; r.confirmedDate = res.confirmedDate; r.confirmedTime = res.confirmedTime; }
        else if (payload.action === 'complete') { r.status = 'completed'; }
        $('allDemos').innerHTML = demosTable(DEMOS);
        openDrawer('demo', idx);
      } catch (e) { demoMsg('Network error — try again.'); if (btn) btn.disabled = false; }
    }
    function wireDemoActions(idx) {
      var c = $('demoConfirm');
      if (c) c.addEventListener('click', function () {
        var date = ($('demoDate') || {}).value || '';
        var time = ($('demoTime') || {}).value || '';
        if (!date || !time) { demoMsg('Pick a date and time first.'); return; }
        doDemoAction(idx, { action: 'confirm', date: date, time: time }, c);
      });
      var k = $('demoComplete');
      if (k) k.addEventListener('click', function () { doDemoAction(idx, { action: 'complete' }, k); });
    }

    // ── Private Viewing detail + confirm/complete ─────────────────────────────
    // Parallel to the home-demo drawer above — kept as its own block rather than a
    // shared helper, since a viewing has no shipping address but does have a
    // city/country and a host join link the demo drawer has no equivalent of.
    function confirmViewingMsg(r) {
      var d = fmtISO(r.confirmedDate), t = fmt12(r.confirmedTime);
      var whenTxt = (d || r.date || '') + (t ? ' at ' + t : (r.slot ? ' (' + r.slot + ')' : ''));
      var loc = [r.city, r.country].filter(Boolean).join(', ');
      var subject = 'Your Mir Kash Private Viewing is confirmed';
      var body = 'Hi there,\n\nYour Mir Kash Private Viewing is confirmed for ' + whenTxt + '.\n\n' +
        (loc ? 'Location: ' + loc + '\n' : '') +
        (r.bags ? "Bags we'll show: " + r.bags + '\n' : '') +
        '\nWe look forward to meeting you online. Just reply to this email or call us if anything changes.\n\nWarmly,\nMir Kash';
      var wa = 'Hi there, your Mir Kash Private Viewing is confirmed for ' + whenTxt + '.' +
        (loc ? ' Location: ' + loc + '.' : '') + ' See you then! — Mir Kash';
      return { subject: subject, body: body, wa: wa };
    }
    function buildViewingDrawer(r) {
      var status = r.status || 'requested';
      var bagsList = (r.bags || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var telDigits = (r.phone || '').replace(/[^0-9]/g, '');
      var m = confirmViewingMsg(r);
      var notify = '';
      if (r.email) notify += '<a class="ad-dbtn ad-dbtn--fill" href="mailto:' + esc(r.email) + '?subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body) + '">Email confirmation</a>';
      if (telDigits) notify += '<a class="ad-dbtn ad-dbtn--wa" href="https://wa.me/' + telDigits + '?text=' + encodeURIComponent(m.wa) + '" target="_blank" rel="noopener">WhatsApp</a>';
      // The whole point of this feature: a one-click way for the admin to actually
      // get on the call as host, once the viewing is confirmed and a room exists.
      var hostBtn = (status === 'confirmed' && r.hostRoomUrl) ? '<a class="ad-dbtn ad-dbtn--fill" href="' + esc(r.hostRoomUrl) + '" target="_blank" rel="noopener">Join as host →</a>' : '';

      var actionSect;
      if (status === 'requested') {
        actionSect =
          '<div class="ad-dsect ad-dact"><h3 class="ad-dh3">Confirm this Private Viewing</h3>' +
          '<p class="ad-reqnote">Requested: ' + esc(r.date || '—') + (r.slot ? ' · ' + esc(r.slot) : '') + '</p>' +
          '<div class="ad-form"><label class="ad-flabel">Date<input class="ad-finput" type="date" id="viewingDate"></label>' +
          '<label class="ad-flabel">Time<input class="ad-finput" type="time" id="viewingTime"></label></div>' +
          '<button class="ad-dbtn ad-dbtn--fill ad-dbtn--wide" id="viewingConfirm" type="button">Confirm booking</button>' +
          '<p class="ad-actmsg" id="viewingMsg"></p></div>';
      } else if (status === 'confirmed') {
        actionSect =
          '<div class="ad-dsect ad-dact"><h3 class="ad-dh3">Confirmed for</h3>' +
          '<p class="ad-confirmed">' + esc(fmtISO(r.confirmedDate)) + ' · ' + esc(fmt12(r.confirmedTime)) + '</p>' +
          (hostBtn ? '<div class="ad-dactions">' + hostBtn + '</div>' : '') +
          '<p class="ad-note ad-notifynote">Send the customer their confirmation:</p>' +
          '<div class="ad-dactions">' + notify + '</div>' +
          '<button class="ad-dbtn ad-dbtn--wide" id="viewingComplete" type="button">Mark Private Viewing complete</button>' +
          '<p class="ad-actmsg" id="viewingMsg"></p></div>';
      } else {
        actionSect =
          '<div class="ad-dsect ad-dact"><h3 class="ad-dh3">Private Viewing completed</h3>' +
          '<p class="ad-confirmed">' + (r.confirmedDate ? esc(fmtISO(r.confirmedDate)) + (r.confirmedTime ? ' · ' + esc(fmt12(r.confirmedTime)) : '') : 'Marked complete') + '</p>' +
          (notify ? '<div class="ad-dactions">' + notify + '</div>' : '') + '</div>';
      }

      var footer = [];
      if (r.adminUrl) footer.push('<a class="ad-dbtn" href="' + esc(r.adminUrl) + '" target="_blank" rel="noopener">Open in Shopify →</a>');
      if (telDigits) footer.push('<a class="ad-dbtn" href="tel:+' + telDigits + '">Call</a>');

      var location = [r.city, r.country].filter(Boolean).join(', ');

      return '' +
        '<div class="ad-dhead">' + viewingPill(status) +
          '<h2 class="ad-display ad-dtitle">' + esc(viewingWho(r)) + '</h2>' +
          '<p class="ad-dmeta">' + esc(r.name) + ' · Booked ' + when(r.createdAt) + '</p>' +
        '</div>' +
        actionSect +
        '<div class="ad-dsect"><h3 class="ad-dh3">Contact</h3>' +
          '<div class="ad-drow"><span class="ad-dk">Email</span><span class="ad-dvv">' + (r.email ? esc(r.email) : '<span class="ad-dv">—</span>') + '</span></div>' +
          '<div class="ad-drow"><span class="ad-dk">Phone</span><span class="ad-dvv">' + (r.phone ? esc(r.phone) : '<span class="ad-dv">—</span>') + '</span></div>' +
        '</div>' +
        '<div class="ad-dsect"><h3 class="ad-dh3">Requested slot</h3><p class="ad-daddr">' + esc(r.date || '—') + (r.slot ? '<br>' + esc(r.slot) : '') + '</p></div>' +
        '<div class="ad-dsect"><h3 class="ad-dh3">Bags to show</h3>' + (bagsList.length ? '<ul class="ad-baglist">' + bagsList.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>' : '<p class="ad-dv">—</p>') + '</div>' +
        '<div class="ad-dsect"><h3 class="ad-dh3">Location</h3><p class="ad-daddr">' + (location ? esc(location) : '<span class="ad-dv">—</span>') + '</p></div>' +
        (footer.length ? '<div class="ad-dactions">' + footer.join('') + '</div>' : '');
    }
    function viewingMsg(t) { var el = $('viewingMsg'); if (el) el.textContent = t || ''; }
    async function doViewingAction(idx, payload, btn) {
      var r = VIEWINGS[idx]; if (!r) return;
      viewingMsg('Saving…'); if (btn) btn.disabled = true;
      var headers = await authHeaders();
      if (!headers) { viewingMsg('Session expired — reload and sign in again.'); if (btn) btn.disabled = false; return; }
      headers['Content-Type'] = 'application/json';
      try {
        var resp = await fetch('/api/admin/viewing', { method: 'POST', headers: headers, body: JSON.stringify(Object.assign({ id: r.id }, payload)) });
        var res = await resp.json().catch(function () { return null; });
        if (!resp.ok || !res || !res.ok) { viewingMsg((res && res.error) || 'Could not save — try again.'); if (btn) btn.disabled = false; return; }
        if (payload.action === 'confirm') { r.status = 'confirmed'; r.confirmedDate = res.confirmedDate; r.confirmedTime = res.confirmedTime; }
        else if (payload.action === 'complete') { r.status = 'completed'; }
        $('allViewings').innerHTML = viewingsTable(VIEWINGS);
        openViewingDrawer(idx);
      } catch (e) { viewingMsg('Network error — try again.'); if (btn) btn.disabled = false; }
    }
    function wireViewingActions(idx) {
      var c = $('viewingConfirm');
      if (c) c.addEventListener('click', function () {
        var date = ($('viewingDate') || {}).value || '';
        var time = ($('viewingTime') || {}).value || '';
        if (!date || !time) { viewingMsg('Pick a date and time first.'); return; }
        doViewingAction(idx, { action: 'confirm', date: date, time: time }, c);
      });
      var k = $('viewingComplete');
      if (k) k.addEventListener('click', function () { doViewingAction(idx, { action: 'complete' }, k); });
    }
    function openViewingDrawer(idx) {
      var r = VIEWINGS[idx];
      if (!r) return;
      $('drawerBody').innerHTML = buildViewingDrawer(r);
      $('drawerBody').scrollTop = 0;
      openDrawerShell();
      wireViewingActions(idx);
    }

    function openDrawer(kind, idx) {
      var r = DEMOS[idx];
      if (!r) return;
      $('drawerBody').innerHTML = buildDemoDrawer(r);
      $('drawerBody').scrollTop = 0;
      openDrawerShell();
      wireDemoActions(idx);
    }
    var DRAWER_OPENER = null;
    function openDrawerShell() {
      DRAWER_OPENER = document.activeElement;
      $('drawer').hidden = false;
      document.body.style.overflow = 'hidden';
      try { $('drawerClose').focus(); } catch (e) {}
    }
    function closeDrawer() {
      $('drawer').hidden = true;
      document.body.style.overflow = '';
      try { if (DRAWER_OPENER && DRAWER_OPENER.focus) DRAWER_OPENER.focus(); } catch (e) {}
    }
    $('allDemos').addEventListener('click', function (e) {
      var tr = e.target.closest ? e.target.closest('tr[data-idx]') : null;
      if (tr) openDrawer('demo', Number(tr.getAttribute('data-idx')));
    });
    $('allViewings').addEventListener('click', function (e) {
      var tr = e.target.closest ? e.target.closest('tr[data-idx]') : null;
      if (tr) openViewingDrawer(Number(tr.getAttribute('data-idx')));
    });
    $('drawerClose').addEventListener('click', closeDrawer);
    $('drawerScrim').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('drawer').hidden) closeDrawer(); });

    return { openDrawerHtml: function (h) { $('drawerBody').innerHTML = h; $('drawerBody').scrollTop = 0; openDrawerShell(); }, drawerOpen: function () { return !$('drawer').hidden; }, setDrawerHtml: function (h) { $('drawerBody').innerHTML = h; }, renderOps: renderOps, renderAffiliateOnly: renderAffiliateOnly, openLegacyPerson: openLegacyPerson, loadTeam: loadTeam, renderDaily: renderDaily, rerender: rerender, setShowHidden: function (v) { SHOW_HIDDEN = v; }, setShowBots: function (v) { SHOW_BOTS = v; }, badges: renderBadges, markSeen: markSeen, getPeople: function () { return PEOPLE; } };
}
