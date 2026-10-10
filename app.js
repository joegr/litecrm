(function () {
  "use strict";

  // --- Config ---
  const API = (window.LITECRM_API || "http://localhost:8000").replace(/\/+$/, "") + "/api";

  // --- State ---
  let token = localStorage.getItem("token");
  let currentPage = null;
  let nextPage = null;
  let prevPage = null;
  let searchTimeout = null;

  // --- DOM refs ---
  const $ = (s) => document.querySelector(s);
  const loginView = $("#login-view");
  const mainView = $("#main-view");
  const loginForm = $("#login-form");
  const loginError = $("#login-error");
  const userName = $("#user-name");
  const logoutBtn = $("#logout-btn");
  const tabs = document.querySelectorAll(".tab");
  const contactsTab = $("#contacts-tab");
  const activityTab = $("#activity-tab");
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

  // --- API helpers ---

  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...opts.headers };
    if (token) headers["Authorization"] = "Token " + token;
    const url = path.startsWith("http") ? path : API + path;
    const res = await fetch(url, { ...opts, headers });
    if (res.status === 401) {
      logout();
      throw new Error("Unauthorized");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || body.detail || "Request failed (" + res.status + ")");
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
  }

  function showMain(user) {
    loginView.hidden = true;
    mainView.hidden = false;
    userName.textContent = user.username;
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
    const size = rows.length;
    if (total > 0) {
      pageInfo.textContent = size + " of " + total;
    }

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
      tr.onclick = () => openEdit(c);
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
    if (id) {
      await api("/contacts/" + id + "/", { method: "PUT", body: JSON.stringify(body) });
    } else {
      await api("/contacts/", { method: "POST", body: JSON.stringify(body) });
    }
    contactDialog.close();
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

  // --- Tabs ---

  function switchTab(name) {
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    contactsTab.hidden = name !== "contacts";
    activityTab.hidden = name !== "activity";
    if (name === "activity") loadActivity();
  }

  // --- Helpers ---

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s || "";
    return d.innerHTML;
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

  // --- Boot ---
  checkAuth();
})();
