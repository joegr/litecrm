(function () {
  "use strict";

  // --- Config ---
  const API = (window.LITECRM_API || "http://localhost:8000").replace(/\/+$/, "") + "/api";

  // --- State ---
  let token = localStorage.getItem("token");
  let nextPage = null;
  let prevPage = null;
  let searchTimeout = null;
  let currentContact = null;
  let pendingEvent = null;
  let dashDays = 30;
  let dashData = null;

  // --- DOM refs ---
  const $ = (s) => document.querySelector(s);
  const loginView = $("#login-view");
  const mainView = $("#main-view");
  const loginForm = $("#login-form");
  const loginError = $("#login-error");
  const userName = $("#user-name");
  const logoutBtn = $("#logout-btn");
  const tabs = document.querySelectorAll(".tab");
  const dashboardTabBtn = $("#dashboard-tab-btn");
  const panels = {
    contacts: $("#contacts-tab"),
    activity: $("#activity-tab"),
    dashboard: $("#dashboard-tab"),
  };
  const contactsList = $("#contacts-list");
  const contactDetail = $("#contact-detail");
  const searchInput = $("#search-input");
  const addBtn = $("#add-btn");
  const contactsBody = $("#contacts-body");
  const contactsEmpty = $("#contacts-empty");
  const contactsPager = $("#contacts-pager");
  const prevBtn = $("#prev-btn");
  const nextBtn = $("#next-btn");
  const pageInfo = $("#page-info");
  const activityList = $("#activity-list");
  const activityEmpty = $("#activity-empty");
  const contactDialog = $("#contact-dialog");
  const contactForm = $("#contact-form");
  const dialogTitle = $("#dialog-title");
  const deleteDialog = $("#delete-dialog");
  const deleteName = $("#delete-name");
  const deleteCancel = $("#delete-cancel");
  const deleteConfirm = $("#delete-confirm");
  const commForm = $("#comm-form");
  const timeline = $("#timeline");
  const timelineEmpty = $("#timeline-empty");
  const eventDialog = $("#event-dialog");
  const eventForm = $("#event-form");

  // --- API helpers ---

  function errorMessage(body, status) {
    if (body.error) return body.error;
    if (body.detail) return body.detail;
    const parts = Object.entries(body).map(([field, msgs]) => {
      const text = [].concat(msgs).join(" ");
      return field === "non_field_errors" ? text : field.replace(/_/g, " ") + ": " + text;
    });
    return parts.join(" ") || "Request failed (" + status + ")";
  }

  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...opts.headers };
    if (token) headers["Authorization"] = "Token " + token;
    const url = path.startsWith("http") ? path : API + path;
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401 && token) {
      logout();
      throw new Error("Unauthorized");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(errorMessage(body, res.status));
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // --- Auth ---

  async function login(username, password) {
    const data = await api("/auth/login/", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    token = data.token;
    localStorage.setItem("token", token);
    showMain(data.user);
  }

  function logout() {
    if (token) {
      api("/auth/logout/", { method: "POST" }).catch(() => {});
    }
    token = null;
    localStorage.removeItem("token");
    showLogin();
  }

  async function checkAuth() {
    if (!token) return showLogin();
    try {
      const user = await api("/auth/me/");
      showMain(user);
    } catch {
      showLogin();
    }
  }

  // --- Views ---

  function showLogin() {
    loginView.hidden = false;
    mainView.hidden = true;
    loginForm.reset();
    loginError.hidden = true;
    dashData = null;
  }

  function showMain(user) {
    loginView.hidden = true;
    mainView.hidden = false;
    userName.textContent = user.username;
    dashboardTabBtn.hidden = !user.is_staff;
    closeDetail();
    switchTab("contacts");
    loadContacts();
  }

  // --- Contacts ---

  async function loadContacts(url) {
    const q = searchInput.value.trim();
    const target = url || API + "/contacts/" + (q ? "?q=" + encodeURIComponent(q) : "");
    const data = await api(target);
    renderContacts(data);
  }

  function renderContacts(data) {
    const rows = data.results || data;
    contactsBody.innerHTML = "";
    contactsEmpty.hidden = rows.length > 0;
    contactsPager.hidden = !data.next && !data.previous;

    nextPage = data.next;
    prevPage = data.previous;
    nextBtn.disabled = !nextPage;
    prevBtn.disabled = !prevPage;

    const total = data.count ?? rows.length;
    if (total > 0) pageInfo.textContent = rows.length + " of " + total;

    rows.forEach((c) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + esc(c.name) + "</td>" +
        "<td>" + esc(c.email) + "</td>" +
        "<td>" + esc(c.phone) + "</td>" +
        "<td>" + esc(c.company) + "</td>" +
        '<td><button class="btn-icon edit-btn" title="Edit">&#9998;</button> ' +
        '<button class="btn-icon del-btn" title="Delete">&#10005;</button></td>';
      tr.querySelector(".edit-btn").onclick = (e) => { e.stopPropagation(); openEdit(c); };
      tr.querySelector(".del-btn").onclick = (e) => { e.stopPropagation(); openDelete(c); };
      tr.onclick = () => openDetail(c);
      contactsBody.appendChild(tr);
    });
  }

  // --- Contact dialog ---

  function openNew() {
    dialogTitle.textContent = "New contact";
    contactForm.reset();
    $("#contact-id").value = "";
    contactDialog.showModal();
  }

  function openEdit(c) {
    dialogTitle.textContent = "Edit contact";
    $("#contact-id").value = c.id;
    $("#c-name").value = c.name;
    $("#c-email").value = c.email;
    $("#c-phone").value = c.phone;
    $("#c-company").value = c.company;
    $("#c-notes").value = c.notes;
    contactDialog.showModal();
  }

  async function saveContact() {
    const id = $("#contact-id").value;
    const body = {
      name: $("#c-name").value,
      email: $("#c-email").value,
      phone: $("#c-phone").value,
      company: $("#c-company").value,
      notes: $("#c-notes").value,
    };
    const saved = id
      ? await api("/contacts/" + id + "/", { method: "PUT", body: JSON.stringify(body) })
      : await api("/contacts/", { method: "POST", body: JSON.stringify(body) });
    contactDialog.close();
    if (currentContact && currentContact.id === saved.id) {
      currentContact = saved;
      renderDetailHead();
    }
    loadContacts();
  }

  // --- Delete dialog ---

  let deleteId = null;

  function openDelete(c) {
    deleteId = c.id;
    deleteName.textContent = c.name;
    deleteDialog.showModal();
  }

  async function confirmDelete() {
    await api("/contacts/" + deleteId + "/", { method: "DELETE" });
    deleteDialog.close();
    deleteId = null;
    loadContacts();
  }

  // --- Contact detail & communication history ---

  const CHANNEL_LABEL = { email: "Email", call: "Call", meeting: "Meeting", note: "Note" };
  const EVENT_LABEL = { open: "Opened", click: "Clicked", reply: "Replied" };

  function openDetail(c) {
    currentContact = c;
    contactsList.hidden = true;
    contactDetail.hidden = false;
    renderDetailHead();
    resetCommForm();
    loadTimeline();
    window.scrollTo(0, 0);
  }

  function closeDetail() {
    currentContact = null;
    contactDetail.hidden = true;
    contactsList.hidden = false;
  }

  function renderDetailHead() {
    const c = currentContact;
    $("#d-name").textContent = c.name;
    $("#d-meta").textContent = [c.company, c.email, c.phone].filter(Boolean).join(" · ");
    const notes = $("#d-notes");
    notes.textContent = c.notes || "";
    notes.hidden = !c.notes;
  }

  function resetCommForm() {
    commForm.reset();
    $("#cm-when").value = toLocalInput(new Date());
    $("#cm-error").hidden = true;
    syncDirection();
  }

  function syncDirection() {
    $("#cm-direction-wrap").hidden = $("#cm-channel").value === "note";
  }

  async function logCommunication() {
    const channel = $("#cm-channel").value;
    const body = {
      contact: currentContact.id,
      channel,
      direction: channel === "note" ? "outbound" : $("#cm-direction").value,
      subject: $("#cm-subject").value,
      body: $("#cm-body").value,
      occurred_at: new Date($("#cm-when").value).toISOString(),
    };
    await api("/communications/", { method: "POST", body: JSON.stringify(body) });
    resetCommForm();
    loadTimeline();
  }

  async function loadTimeline() {
    const contactId = currentContact.id;
    const items = [];
    let url = API + "/communications/?contact=" + contactId;
    while (url) {
      const data = await api(url);
      items.push(...data.results);
      url = data.next;
    }
    if (!currentContact || currentContact.id !== contactId) return;
    renderTimeline(items);
  }

  function directionText(comm) {
    if (comm.channel === "note") return "Note";
    if (comm.channel === "email") return comm.direction === "outbound" ? "Email sent" : "Email received";
    return (comm.direction === "outbound" ? "Outbound " : "Inbound ") + comm.channel;
  }

  function renderTimeline(items) {
    timeline.innerHTML = "";
    timelineEmpty.hidden = items.length > 0;

    items.forEach((comm) => {
      const li = document.createElement("li");
      li.className = "tl-item tl-" + comm.channel;
      const tracked = comm.channel === "email" && comm.direction === "outbound";

      li.innerHTML =
        '<div class="tl-head">' +
          '<span class="badge">' + esc(CHANNEL_LABEL[comm.channel]) + "</span>" +
          '<span class="tl-kind">' + esc(directionText(comm)) + "</span>" +
          '<span class="tl-time">' + fmtTime(comm.occurred_at) + "</span>" +
          '<button class="btn-icon tl-del" title="Delete">&#10005;</button>' +
        "</div>" +
        (comm.subject ? '<div class="tl-subject">' + esc(comm.subject) + "</div>" : "") +
        (comm.body ? '<div class="tl-body">' + esc(comm.body) + "</div>" : "") +
        (tracked
          ? '<div class="tl-events"></div>' +
            '<div class="tl-actions">' +
              '<button data-type="open">+ Opened</button>' +
              '<button data-type="click">+ Clicked</button>' +
              '<button data-type="reply">+ Replied</button>' +
            "</div>"
          : "");

      li.querySelector(".tl-del").onclick = async () => {
        if (!confirm("Delete this " + CHANNEL_LABEL[comm.channel].toLowerCase() + "?")) return;
        try {
          await api("/communications/" + comm.id + "/", { method: "DELETE" });
          loadTimeline();
        } catch (err) { alert(err.message); }
      };

      if (tracked) {
        const evWrap = li.querySelector(".tl-events");
        comm.events.forEach((ev) => evWrap.appendChild(eventChip(ev)));
        li.querySelectorAll(".tl-actions button").forEach((b) => {
          b.onclick = () => openEventDialog(comm, b.dataset.type);
        });
      }
      timeline.appendChild(li);
    });
  }

  function eventChip(ev) {
    const chip = document.createElement("span");
    chip.className = "chip chip-" + ev.type;
    let html = "<strong>" + esc(EVENT_LABEL[ev.type]) + "</strong> " + fmtTime(ev.occurred_at);
    if (ev.url && /^https?:\/\//i.test(ev.url)) {
      html += ' · <a href="' + esc(ev.url) + '" target="_blank" rel="noopener noreferrer">' +
        esc(shortUrl(ev.url)) + "</a>";
    }
    if (ev.note) html += " · " + esc(ev.note);
    html += '<button class="chip-x" title="Remove">&#10005;</button>';
    chip.innerHTML = html;
    chip.querySelector(".chip-x").onclick = async () => {
      try {
        await api("/events/" + ev.id + "/", { method: "DELETE" });
        loadTimeline();
      } catch (err) { alert(err.message); }
    };
    return chip;
  }

  function openEventDialog(comm, type) {
    pendingEvent = { comm, type };
    eventForm.reset();
    $("#ev-title").textContent = { open: "Record open", click: "Record click", reply: "Record reply" }[type];
    const sent = new Date(comm.occurred_at);
    const now = new Date();
    $("#ev-when").value = toLocalInput(now > sent ? now : sent);
    $("#ev-when").min = toLocalInput(sent);
    $("#ev-url-wrap").hidden = type !== "click";
    $("#ev-error").hidden = true;
    eventDialog.showModal();
  }

  async function saveEvent() {
    const { comm, type } = pendingEvent;
    const body = {
      communication: comm.id,
      type,
      occurred_at: new Date($("#ev-when").value).toISOString(),
      note: $("#ev-note").value,
    };
    if (type === "click") body.url = $("#ev-url").value.trim();
    await api("/events/", { method: "POST", body: JSON.stringify(body) });
    eventDialog.close();
    pendingEvent = null;
    loadTimeline();
  }

  // --- Activity ---

  async function loadActivity() {
    const data = await api("/activity/");
    const rows = data.results || data;
    activityList.innerHTML = "";
    activityEmpty.hidden = rows.length > 0;

    rows.forEach((a) => {
      const li = document.createElement("li");
      li.innerHTML =
        "<span><strong>" + esc(a.user) + "</strong> " + esc(a.action) +
        (a.target ? " <em>" + esc(a.target) + "</em>" : "") + "</span>" +
        '<span class="act-time">' + fmtTime(a.created_at) + "</span>";
      activityList.appendChild(li);
    });
  }

  // --- Dashboard (staff only; the API enforces it too) ---

  const SERIES = [
    { key: "emails", label: "Emails", color: "var(--series-1)", value: (d) => d.emails_sent + d.emails_received },
    { key: "calls", label: "Calls", color: "var(--series-2)", value: (d) => d.calls },
    { key: "meetings", label: "Meetings", color: "var(--series-3)", value: (d) => d.meetings },
    { key: "notes", label: "Notes", color: "var(--series-4)", value: (d) => d.notes },
  ];

  function isoDay(d) {
    return d.toISOString().slice(0, 10);
  }

  async function loadDashboard() {
    const to = new Date();
    const from = new Date(to.getTime() - (dashDays - 1) * 86400000);
    const user = $("#dash-user").value;
    const qs = "?from=" + isoDay(from) + "&to=" + isoDay(to) + (user ? "&user=" + user : "");
    $("#dash-error").hidden = true;
    try {
      dashData = await api("/metrics/summary/" + qs);
    } catch (err) {
      $("#dash-error").textContent = err.message;
      $("#dash-error").hidden = false;
      return;
    }
    renderDashboard();
  }

  function renderDashboard() {
    const d = dashData;
    $("#dash-range").textContent = fmtDay(d.from) + " – " + fmtDay(d.to) + " (UTC)";

    const sel = $("#dash-user");
    const current = sel.value;
    sel.innerHTML = '<option value="">All users</option>' +
      d.users.map((u) => '<option value="' + u.id + '">' + esc(u.username) + "</option>").join("");
    sel.value = current;

    renderKpis(d.totals);
    renderLegend();
    renderChart(d.daily);
    renderChartTable(d.daily);
    renderPerUser(d.per_user);
    renderTopContacts(d.top_contacts);
  }

  function pct(rate) {
    return rate === null || rate === undefined ? "—" : Math.round(rate * 100) + "%";
  }

  function renderKpis(t) {
    const tiles = [
      ["Emails sent", t.emails_sent, t.emails_received + " received"],
      ["Open rate", pct(t.open_rate), t.emails_opened + " of " + t.emails_sent + " opened"],
      ["Click rate", pct(t.click_rate), t.clicks_total + (t.clicks_total === 1 ? " click · " : " clicks · ") + pct(t.click_to_open_rate) + " of opens"],
      ["Reply rate", pct(t.reply_rate), t.emails_replied + " replied"],
      ["Calls", t.calls, ""],
      ["Meetings", t.meetings, t.notes + " notes"],
    ];
    $("#kpis").innerHTML = tiles.map(([label, value, sub]) =>
      '<div class="kpi"><div class="kpi-label">' + esc(label) + "</div>" +
      '<div class="kpi-value">' + esc(String(value)) + "</div>" +
      '<div class="kpi-sub">' + esc(sub) + "</div></div>"
    ).join("");
  }

  function renderLegend() {
    $("#chart-legend").innerHTML = SERIES.map((s) =>
      '<span class="legend-item"><span class="swatch" style="background:' + s.color + '"></span>' +
      esc(s.label) + "</span>"
    ).join("");
  }

  function niceStep(max) {
    if (max <= 4) return 1;
    const raw = max / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  function roundedTopRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h);
    return "M" + x + "," + (y + h) + "V" + (y + r) +
      "Q" + x + "," + y + " " + (x + r) + "," + y +
      "H" + (x + w - r) + "Q" + (x + w) + "," + y + " " + (x + w) + "," + (y + r) +
      "V" + (y + h) + "Z";
  }

  function renderChart(daily) {
    const el = $("#chart");
    const width = Math.max(300, el.clientWidth || 600);
    const height = 220;
    const m = { top: 8, right: 8, bottom: 24, left: 36 };
    const plotW = width - m.left - m.right;
    const plotH = height - m.top - m.bottom;

    const totals = daily.map((d) => SERIES.reduce((sum, s) => sum + s.value(d), 0));
    const step = niceStep(Math.max(...totals, 1));
    const yMax = Math.max(step, Math.ceil(Math.max(...totals, 1) / step) * step);
    const y = (v) => m.top + plotH - (v / yMax) * plotH;

    const band = plotW / daily.length;
    const barW = Math.max(2, Math.min(28, band * 0.7));
    const labelEvery = Math.ceil(daily.length / 6);

    let svg = '<svg width="' + width + '" height="' + height + '" role="img" aria-label="Daily communications by type">';

    for (let v = 0; v <= yMax; v += step) {
      const yy = y(v);
      svg += '<line class="grid" x1="' + m.left + '" x2="' + (width - m.right) + '" y1="' + yy + '" y2="' + yy + '"/>';
      svg += '<text class="tick" x="' + (m.left - 6) + '" y="' + (yy + 4) + '" text-anchor="end">' + v + "</text>";
    }

    daily.forEach((d, i) => {
      const x = m.left + i * band + (band - barW) / 2;
      let base = 0;
      const segs = SERIES.map((s) => ({ s, v: s.value(d) })).filter((p) => p.v > 0);
      segs.forEach((p, j) => {
        const top = y(base + p.v);
        const bottom = y(base);
        const gap = j > 0 ? 2 : 0;
        const h = Math.max(0, bottom - top - gap);
        if (j === segs.length - 1) {
          svg += '<path d="' + roundedTopRect(x, top, barW, h, 4) + '" fill="' + p.s.color + '"/>';
        } else {
          svg += '<rect x="' + x + '" y="' + top + '" width="' + barW + '" height="' + h + '" fill="' + p.s.color + '"/>';
        }
        base += p.v;
      });
      if (i % labelEvery === 0) {
        svg += '<text class="tick" x="' + (m.left + i * band + band / 2) + '" y="' + (height - 6) +
          '" text-anchor="middle">' + fmtDayShort(d.date) + "</text>";
      }
    });

    svg += '<line class="baseline" x1="' + m.left + '" x2="' + (width - m.right) + '" y1="' + y(0) + '" y2="' + y(0) + '"/>';
    daily.forEach((d, i) => {
      svg += '<rect class="hit" data-i="' + i + '" x="' + (m.left + i * band) + '" y="' + m.top +
        '" width="' + band + '" height="' + plotH + '"/>';
    });
    svg += "</svg>";
    el.innerHTML = svg;

    const tip = $("#chart-tip");
    el.querySelectorAll(".hit").forEach((hit) => {
      hit.addEventListener("mouseenter", () => {
        const d = daily[Number(hit.dataset.i)];
        hit.classList.add("on");
        tip.innerHTML = "<strong>" + fmtDay(d.date) + "</strong>" +
          SERIES.map((s) =>
            '<div class="tip-row"><span class="swatch" style="background:' + s.color + '"></span>' +
            esc(s.label) + "<span>" + s.value(d) + "</span></div>"
          ).join("");
        tip.hidden = false;
        const box = el.getBoundingClientRect();
        const hb = hit.getBoundingClientRect();
        const left = hb.left - box.left + hb.width / 2;
        tip.style.left = (el.offsetLeft + Math.min(Math.max(left, 80), box.width - 80)) + "px";
        tip.style.top = el.offsetTop + "px";
      });
      hit.addEventListener("mouseleave", () => {
        hit.classList.remove("on");
        tip.hidden = true;
      });
    });
  }

  function table(headers, rows, numericFrom) {
    if (!rows.length) return '<div class="empty-state small">No data in this range.</div>';
    return "<table class=\"data\"><thead><tr>" +
      headers.map((h, i) => "<th" + (i >= numericFrom ? ' class="num"' : "") + ">" + esc(h) + "</th>").join("") +
      "</tr></thead><tbody>" +
      rows.map((r) => "<tr>" + r.map((c, i) =>
        "<td" + (i >= numericFrom ? ' class="num"' : "") + ">" + esc(String(c)) + "</td>"
      ).join("") + "</tr>").join("") +
      "</tbody></table>";
  }

  function renderChartTable(daily) {
    const rows = daily.map((d) => [fmtDay(d.date), ...SERIES.map((s) => s.value(d))]);
    $("#chart-table").innerHTML = table(["Date", ...SERIES.map((s) => s.label)], rows, 1);
  }

  function renderPerUser(users) {
    $("#per-user").innerHTML = table(
      ["User", "Emails sent", "Open", "Click", "Reply", "Calls", "Meetings", "Notes"],
      users.map((u) => [u.username, u.emails_sent, pct(u.open_rate), pct(u.click_rate),
        pct(u.reply_rate), u.calls, u.meetings, u.notes]),
      1
    );
  }

  function renderTopContacts(contacts) {
    $("#top-contacts").innerHTML = table(
      ["Contact", "Company", "Owner", "Communications", "Engagements", "Last contact"],
      contacts.map((c) => [c.name, c.company || "—", c.owner, c.communications, c.engagements,
        fmtTime(c.last_contact)]),
      3
    );
  }

  // --- Tabs ---

  function switchTab(name) {
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    Object.entries(panels).forEach(([key, panel]) => { panel.hidden = key !== name; });
    if (name === "activity") loadActivity();
    if (name === "dashboard") loadDashboard();
  }

  // --- Helpers ---

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s ?? "";
    return d.innerHTML.replace(/"/g, "&quot;");
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function fmtDay(isoDate) {
    return new Date(isoDate + "T00:00:00Z").toLocaleDateString([], { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }

  function fmtDayShort(isoDate) {
    return new Date(isoDate + "T00:00:00Z").toLocaleDateString([], { month: "short", day: "numeric", timeZone: "UTC" });
  }

  function toLocalInput(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate()) +
      "T" + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function shortUrl(url) {
    const s = url.replace(/^https?:\/\//i, "");
    return s.length > 40 ? s.slice(0, 37) + "…" : s;
  }

  // --- Event wiring ---

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    try {
      await login($("#login-user").value, $("#login-pass").value);
    } catch (err) {
      loginError.textContent = err.message;
      loginError.hidden = false;
    }
  });

  logoutBtn.addEventListener("click", logout);

  tabs.forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

  addBtn.addEventListener("click", openNew);

  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await saveContact(); } catch (err) { alert(err.message); }
  });

  $("#dialog-cancel").addEventListener("click", () => contactDialog.close());
  deleteCancel.addEventListener("click", () => deleteDialog.close());
  deleteConfirm.addEventListener("click", async () => {
    try { await confirmDelete(); } catch (err) { alert(err.message); }
  });

  prevBtn.addEventListener("click", () => { if (prevPage) loadContacts(prevPage); });
  nextBtn.addEventListener("click", () => { if (nextPage) loadContacts(nextPage); });

  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadContacts(), 300);
  });

  $("#back-btn").addEventListener("click", () => { closeDetail(); loadContacts(); });
  $("#d-edit-btn").addEventListener("click", () => openEdit(currentContact));
  $("#cm-channel").addEventListener("change", syncDirection);

  commForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#cm-error").hidden = true;
    try { await logCommunication(); } catch (err) {
      $("#cm-error").textContent = err.message;
      $("#cm-error").hidden = false;
    }
  });

  eventForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#ev-error").hidden = true;
    try { await saveEvent(); } catch (err) {
      $("#ev-error").textContent = err.message;
      $("#ev-error").hidden = false;
    }
  });
  $("#ev-cancel").addEventListener("click", () => eventDialog.close());

  document.querySelectorAll(".seg button").forEach((b) => {
    b.addEventListener("click", () => {
      dashDays = Number(b.dataset.days);
      document.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("on", x === b));
      loadDashboard();
    });
  });
  $("#dash-user").addEventListener("change", loadDashboard);
  $("#chart-table-btn").addEventListener("click", () => {
    const t = $("#chart-table");
    t.hidden = !t.hidden;
    $("#chart-table-btn").textContent = t.hidden ? "Show table" : "Hide table";
  });

  let resizeTimeout = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      if (dashData && !panels.dashboard.hidden) renderChart(dashData.daily);
    }, 150);
  });

  // --- Boot ---
  checkAuth();
})();
