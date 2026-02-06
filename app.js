/* app.js — Supplier Tracker (split files, hardcoded config via window.__SUPABASE_URL__/__SUPABASE_ANON_KEY__) */
(function () {
  const $ = (id) => document.getElementById(id);

  // ---------- shared helpers ----------
  function showError(msg) {
    const el = $("authError");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.add("show");
  }
  function clearError() {
    const el = $("authError");
    if (!el) return;
    el.textContent = "";
    el.classList.remove("show");
  }
  function money(n) {
    return "₱" + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  // ---------- safety checks ----------
  if (!window.supabase) {
    showError("Supabase JS not loaded. Check your internet or the CDN script tag.");
    return;
  }
  if (!window.__SUPABASE_URL__ || !window.__SUPABASE_ANON_KEY__) {
    showError(
      "Config missing. Edit index.html + orderpage.html and set window.__SUPABASE_URL__ / window.__SUPABASE_ANON_KEY__."
    );
    return;
  }

  // ---------- client ----------
  const supa = window.supabase.createClient(window.__SUPABASE_URL__, window.__SUPABASE_ANON_KEY__);
  const BUCKET = window.__ATTACHMENTS_BUCKET__ || "order_attachments";
  const ADMIN_LIST = Array.isArray(window.__ADMIN_EMAILS__) ? window.__ADMIN_EMAILS__ : [];

  // ---------- LOGIN PAGE ----------
  async function initLogin() {
    const form = $("loginForm");
    const btnLogin = $("btnLogin");
    const email = $("email");
    const password = $("password");
    const clearSession = $("clearSession");

    clearError();

    // if already logged in, go to orders
    const { data } = await supa.auth.getSession();
    if (data?.session) {
      location.replace("./orderpage.html");
      return;
    }

    if (clearSession) {
      clearSession.addEventListener("click", async (e) => {
        e.preventDefault();
        await supa.auth.signOut();
        alert("Session cleared.");
      });
    }

    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearError();
      if (btnLogin) btnLogin.disabled = true;

      try {
        const em = (email?.value || "").trim();
        const pw = password?.value || "";
        if (!em || !pw) {
          showError("Please enter email and password.");
          return;
        }

        const { data, error } = await supa.auth.signInWithPassword({ email: em, password: pw });
        if (error) throw error;

        // ensure session exists
        if (!data?.session) {
          showError("Login failed: no session returned.");
          return;
        }

        location.replace("./orderpage.html");
      } catch (err) {
        showError(err?.message || String(err));
      } finally {
        if (btnLogin) btnLogin.disabled = false;
      }
    });
  }

  // ---------- ORDERS PAGE ----------
  let orders = [];
  let editingId = null;
  let activeTab = "all";

  async function requireSession() {
    clearError();
    const { data, error } = await supa.auth.getSession();
    if (error) {
      showError(error.message);
      return null;
    }
    if (!data?.session) {
      location.replace("./index.html");
      return null;
    }
    return data.session;
  }

  function isAdmin(email) {
    const e = String(email || "").toLowerCase();
    return ADMIN_LIST.map((x) => String(x).toLowerCase()).includes(e);
  }

  function handleDeliveryChange() {
    const inputDelivery = $("delivery_method");
    const inputPaidShip = $("paid_shipping");
    if (!inputDelivery || !inputPaidShip) return;

    if (String(inputDelivery.value) === "walkin") {
      inputPaidShip.value = "0";
      inputPaidShip.disabled = true;
    } else {
      inputPaidShip.disabled = false;
    }
  }

  function resetForm() {
    editingId = null;
    const form = $("orderForm");
    if (form) form.reset();

    const formTitle = $("formTitle");
    if (formTitle) formTitle.textContent = "New Order";

    const status = $("status");
    const delivery = $("delivery_method");
    if (status) status.value = "pending";
    if (delivery) delivery.value = "jnt";
    handleDeliveryChange();

    const msg = $("formMsg");
    if (msg) msg.textContent = "—";

    const attachment = $("attachment");
    if (attachment) attachment.value = "";
  }

  async function uploadAttachment(file) {
    if (!file) return null;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `orders/${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;

    const { error } = await supa.storage.from(BUCKET).upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "image/jpeg",
    });
    if (error) throw error;

    const { data } = supa.storage.from(BUCKET).getPublicUrl(path);
    return data?.publicUrl || null;
  }

  function rebuildDateOptions() {
    const dateFilter = $("dateFilter");
    if (!dateFilter) return;

    const current = dateFilter.value || "all";
    const set = new Set();
    for (const o of orders) if (o.order_date) set.add(o.order_date);

    const sorted = Array.from(set).sort((a, b) => String(b).localeCompare(String(a)));
    dateFilter.innerHTML =
      '<option value="all">All Dates</option>' +
      sorted.map((d) => `<option value="${d}">${d}</option>`).join("");

    dateFilter.value = sorted.includes(current) ? current : "all";
  }

  function filteredOrders() {
    const q = ($("search")?.value || "").trim().toLowerCase();
    const st = $("statusFilter")?.value || "all";
    const dt = $("dateFilter")?.value || "all";

    return orders.filter((o) => {
      const dm = String(o.delivery_method || "jnt").toLowerCase();
      const os = String(o.status || "pending").toLowerCase();

      if (activeTab !== "all" && dm !== activeTab) return false;
      if (st !== "all" && os !== st) return false;
      if (dt !== "all" && String(o.order_date || "") !== dt) return false;

      if (!q) return true;
      const hay = [o.order_id, o.customer_name, o.fb_profile, o.order_details, o.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }

  function renderKPIs() {
    const kpiTotal = $("kpiTotal");
    if (!kpiTotal) return;

    const kpiPaid = $("kpiPaid");
    const kpiPending = $("kpiPending");

    kpiTotal.textContent = String(orders.length);

    const sum = orders.reduce((acc, o) => acc + Number(o.paid_product || 0) + Number(o.paid_shipping || 0), 0);
    if (kpiPaid) kpiPaid.textContent = money(sum);

    const pend = orders.filter((o) => String(o.status || "").toLowerCase() === "pending").length;
    if (kpiPending) kpiPending.textContent = String(pend);
  }

  function pill(text, extra) {
    const s = document.createElement("span");
    s.className = "pill " + (extra || "");
    s.textContent = text;
    return s;
  }

  function renderList() {
    const listEl = $("orderList");
    const countLabel = $("countLabel");
    if (!listEl) return;

    const list = filteredOrders();
    if (countLabel) countLabel.textContent = `${list.length} order${list.length === 1 ? "" : "s"}`;
    renderKPIs();

    listEl.innerHTML = "";

    for (const o of list) {
      const li = document.createElement("li");
      li.className = "item";

      const left = document.createElement("div");
      const title = document.createElement("div");
      title.className = "titleLine";

      const name = document.createElement("div");
      name.style.fontWeight = "900";
      name.textContent = o.customer_name || "(No name)";

      const status = String(o.status || "pending").toUpperCase();
      const dm = String(o.delivery_method || "jnt").toUpperCase();
      const id = o.order_id || "";

      title.appendChild(name);
      title.appendChild(pill(status));
      title.appendChild(pill("🚚 " + dm, "accent"));
      if (id) title.appendChild(pill(id, "ok"));

      const sub = document.createElement("div");
      sub.style.marginTop = "6px";
      sub.style.color = "var(--muted)";
      sub.style.fontSize = "12px";
      sub.textContent = [
        o.order_date ? "📅 " + o.order_date : "",
        "💰 " + money(Number(o.paid_product || 0) + Number(o.paid_shipping || 0)),
        (o.order_details || "").replace(/\s+/g, " ").slice(0, 140),
      ]
        .filter(Boolean)
        .join(" • ");

      left.appendChild(title);
      left.appendChild(sub);

      const right = document.createElement("div");
      right.style.display = "flex";
      right.style.gap = "8px";
      right.style.flexWrap = "wrap";
      right.style.justifyContent = "flex-end";

      if (o.attachment_url) {
        const a = document.createElement("a");
        a.className = "btn";
        a.href = o.attachment_url;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "View";
        right.appendChild(a);
      }

      const edit = document.createElement("button");
      edit.className = "btn";
      edit.type = "button";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => startEdit(o));
      right.appendChild(edit);

      const del = document.createElement("button");
      del.className = "btn danger";
      del.type = "button";
      del.textContent = "Delete";
      del.addEventListener("click", () => deleteOrder(o));
      right.appendChild(del);

      li.appendChild(left);
      li.appendChild(right);
      listEl.appendChild(li);
    }
  }

  function startEdit(o) {
    editingId = o.id;

    const formTitle = $("formTitle");
    if (formTitle) formTitle.textContent = `Edit Order (${o.order_id || o.id})`;

    $("customer_name").value = o.customer_name || "";
    $("fb_profile").value = o.fb_profile || "";
    $("order_details").value = o.order_details || "";
    $("status").value = o.status || "pending";
    $("order_date").value = o.order_date || "";
    $("delivery_method").value = o.delivery_method || "jnt";
    $("paid_product").value = String(o.paid_product ?? "");
    $("paid_shipping").value = String(o.paid_shipping ?? "");
    $("notes").value = o.notes || "";
    handleDeliveryChange();

    const msg = $("formMsg");
    if (msg) msg.textContent = "Editing…";
  }

  async function deleteOrder(o) {
    if (!confirm(`Delete order ${o.order_id || o.id}?`)) return;

    const { error } = await supa.from("orders").delete().eq("id", o.id);
    if (error) {
      showError(error.message || "Delete failed");
      return;
    }
    await loadOrders();
    resetForm();
  }

  async function saveOrder(e) {
    e.preventDefault();
    clearError();

    const msg = $("formMsg");
    const btnSave = $("btnSave");
    if (msg) msg.textContent = "Saving…";
    if (btnSave) btnSave.disabled = true;

    try {
      const session = await requireSession();
      if (!session) return;

      const payload = {
        customer_name: $("customer_name").value.trim(),
        fb_profile: ($("fb_profile").value.trim() || null),
        order_details: $("order_details").value.trim(),
        paid_product: Number($("paid_product").value || 0),
        paid_shipping: Number($("paid_shipping").value || 0),
        status: $("status").value,
        order_date: $("order_date").value || null,
        notes: ($("notes").value.trim() || null),
        delivery_method: $("delivery_method").value,
      };

      // Walk-in always 0 ship
      if (payload.delivery_method === "walkin") payload.paid_shipping = 0;

      // optional: if you added created_by_email column, we fill it (won't break if column doesn't exist)
      payload.created_by_email = session.user?.email || null;

      const file = $("attachment")?.files?.[0] || null;
      if (file) payload.attachment_url = await uploadAttachment(file);

      let res;
      if (editingId) {
        res = await supa.from("orders").update(payload).eq("id", editingId);
      } else {
        res = await supa.from("orders").insert(payload);
      }

      if (res.error) throw res.error;

      if (msg) msg.textContent = "Saved ✅";
      await loadOrders();
      resetForm();
    } catch (err) {
      showError(err?.message || String(err));
      if (msg) msg.textContent = "Save failed";
    } finally {
      if (btnSave) btnSave.disabled = false;
      const attachment = $("attachment");
      if (attachment) attachment.value = "";
    }
  }

  async function loadOrders() {
    const session = await requireSession();
    if (!session) return;

    const userChip = $("userChip");
    if (userChip) userChip.textContent = session.user?.email || "Logged in";

    // admin dashboard toggle
    const dash = $("adminOnlyDashboard");
    if (dash) dash.classList.toggle("hidden", !isAdmin(session.user?.email));

    // IMPORTANT: We select * so it works even if your table has extra columns.
    const { data, error } = await supa.from("orders").select("*").order("last_updated", { ascending: false });

    if (error) {
      showError(
        "Failed to load orders.\n\n" +
          (error.message || String(error)) +
          "\n\nIf your table is empty, this is normal. If you have existing rows, check RLS + policy + table name."
      );
      orders = [];
    } else {
      orders = Array.isArray(data) ? data : [];
    }

    rebuildDateOptions();
    renderList();
  }

  function bindTabs() {
    const tabs = document.querySelectorAll("#tabs .tab");
    tabs.forEach((t) => {
      t.addEventListener("click", () => {
        activeTab = t.dataset.tab || "all";
        tabs.forEach((x) => x.classList.toggle("active", (x.dataset.tab || "all") === activeTab));
        renderList();
      });
    });
  }

  async function initOrders() {
    const session = await requireSession();
    if (!session) return;

    // logout
    const btnLogout = $("btnLogout");
    if (btnLogout) btnLogout.addEventListener("click", async () => {
      await supa.auth.signOut();
      location.replace("./index.html");
    });

    // listeners
    $("btnRefresh")?.addEventListener("click", loadOrders);
    $("btnClear")?.addEventListener("click", resetForm);
    $("orderForm")?.addEventListener("submit", saveOrder);
    $("delivery_method")?.addEventListener("change", handleDeliveryChange);

    $("search")?.addEventListener("input", renderList);
    $("statusFilter")?.addEventListener("change", renderList);
    $("dateFilter")?.addEventListener("change", renderList);

    bindTabs();
    handleDeliveryChange();

    // keep pages in sync if signed out elsewhere
    supa.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") location.replace("./index.html");
    });

    await loadOrders();
    resetForm();
  }

  // ---------- boot ----------
  const page = window.__PAGE__ || "";
  if (page === "login") initLogin();
  else if (page === "orders") initOrders();
  else {
    // fallback: detect by presence of login form
    if ($("loginForm")) initLogin();
    else initOrders();
  }
})();
