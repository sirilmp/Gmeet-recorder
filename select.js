// Custom dropdowns: every <select> on the page gets a styled button + list that matches the rest of the UI.
// The native <select> stays in the page (hidden) and remains the source of truth, so page scripts keep using
// .value, .onchange, .hidden, .disabled and rebuilding options exactly as before.
(() => {
  const CHECK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const CHEV =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10l5 5 5-5"/></svg>';
  let uid = 0;
  let openOne = null; // the dropdown that is open right now (only one at a time)

  function labelFor(sel) {
    if (sel.getAttribute("aria-label")) return sel.getAttribute("aria-label");
    const lab = sel.id && document.querySelector(`label[for="${CSS.escape(sel.id)}"]`);
    if (lab) return lab.textContent.trim();
    const row = sel.closest(".opt");
    const t = row && row.querySelector(".t");
    return t ? t.textContent.trim() : "";
  }

  function enhance(sel) {
    if (sel.dataset.cs) return;
    sel.dataset.cs = "1";
    sel.classList.add("cs-native");
    sel.tabIndex = -1;
    sel.setAttribute("aria-hidden", "true");

    const id = `cs-${++uid}`;
    const wrap = document.createElement("div");
    wrap.className = "cs";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cs-btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-controls", id);
    const label = labelFor(sel);
    if (label) btn.setAttribute("aria-label", label);
    btn.innerHTML = `<span class="cs-face"><span class="cs-value"></span><span class="cs-sizer" aria-hidden="true"></span></span>${CHEV}`;
    const list = document.createElement("div");
    list.className = "cs-list";
    list.id = id;
    list.setAttribute("role", "listbox");
    if (label) list.setAttribute("aria-label", label);
    list.hidden = true;
    list.onpointerdown = (e) => e.preventDefault(); // scrollbar drags keep focus on the button
    wrap.append(btn);
    sel.after(wrap);
    document.body.append(list); // fixed-position layer, so cards and dialogs never clip it

    let active = -1;
    const opts = () => [...sel.options];

    // Rebuild the button text and the list from the native <select>
    function sync() {
      const o = sel.options[sel.selectedIndex];
      btn.querySelector(".cs-value").textContent = o ? o.textContent : "";
      const sizer = btn.querySelector(".cs-sizer");
      sizer.replaceChildren(...opts().map((x) => Object.assign(document.createElement("span"), { textContent: x.textContent })));
      list.replaceChildren(
        ...opts().map((x, i) => {
          const it = document.createElement("div");
          it.className = "cs-opt";
          it.id = `${id}-${i}`;
          it.setAttribute("role", "option");
          it.setAttribute("aria-selected", String(i === sel.selectedIndex));
          if (x.disabled) it.setAttribute("aria-disabled", "true");
          it.innerHTML = `<span></span>${CHECK}`;
          it.firstChild.textContent = x.textContent;
          it.onpointerdown = (e) => e.preventDefault(); // keep focus on the button
          it.onclick = () => !x.disabled && choose(i);
          it.onpointermove = () => setActive(i, false);
          return it;
        })
      );
      wrap.hidden = sel.hidden;
      btn.disabled = sel.disabled;
      if (open() && (sel.hidden || sel.disabled)) close();
      else if (open()) setActive(Math.min(active, sel.options.length - 1), false);
    }

    // Programmatic `sel.value = …` / `selectedIndex = …` fire no events, so watch the setters too
    for (const prop of ["value", "selectedIndex"]) {
      const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, prop);
      Object.defineProperty(sel, prop, {
        configurable: true,
        get() {
          return d.get.call(this);
        },
        set(v) {
          d.set.call(this, v);
          sync();
        },
      });
    }
    new MutationObserver(sync).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden", "disabled", "selected"] });

    const open = () => !list.hidden;
    function setActive(i, scroll = true) {
      active = i;
      [...list.children].forEach((el, k) => el.classList.toggle("active", k === i));
      const el = list.children[i];
      if (el) {
        btn.setAttribute("aria-activedescendant", el.id);
        if (scroll) el.scrollIntoView({ block: "nearest" });
      } else btn.removeAttribute("aria-activedescendant");
    }
    function place() {
      const r = btn.getBoundingClientRect();
      const below = innerHeight - r.bottom - 8;
      const above = r.top - 8;
      list.style.minWidth = r.width + "px";
      list.style.maxWidth = Math.max(r.width, Math.min(420, innerWidth - 16)) + "px";
      list.style.maxHeight = "";
      const h = Math.min(list.scrollHeight, 300);
      const up = h > below && above > below;
      list.style.maxHeight = Math.max(80, Math.min(300, up ? above - 4 : below - 4)) + "px";
      list.style.top = up ? "" : r.bottom + 4 + "px";
      list.style.bottom = up ? innerHeight - r.top + 4 + "px" : "";
      list.style.left = Math.max(8, Math.min(r.left, innerWidth - list.offsetWidth - 8)) + "px";
      list.classList.toggle("up", up);
    }
    function show() {
      if (open() || btn.disabled) return;
      if (openOne) openOne();
      openOne = close;
      list.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      wrap.classList.add("open");
      place();
      setActive(Math.max(0, sel.selectedIndex));
    }
    function close() {
      if (!open()) return;
      list.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      btn.removeAttribute("aria-activedescendant");
      wrap.classList.remove("open");
      if (openOne === close) openOne = null;
    }
    function choose(i) {
      close();
      btn.focus();
      if (i === sel.selectedIndex) return;
      sel.selectedIndex = i;
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    function step(from, dir) {
      const o = opts();
      for (let i = from + dir; i >= 0 && i < o.length; i += dir) if (!o[i].disabled) return i;
      return from;
    }

    btn.onclick = () => (open() ? close() : show());
    let typed = "";
    let typedAt = 0;
    btn.onkeydown = (e) => {
      const n = sel.options.length;
      if (!open()) {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
          e.preventDefault();
          show();
        }
        return;
      }
      if (e.key === "ArrowDown") setActive(step(active, 1));
      else if (e.key === "ArrowUp") setActive(step(active, -1));
      else if (e.key === "Home") setActive(step(-1, 1));
      else if (e.key === "End") setActive(step(n, -1));
      else if (e.key === "Enter" || e.key === " ") {
        if (active >= 0 && !sel.options[active].disabled) choose(active);
      } else if (e.key === "Escape") {
        close();
        e.stopPropagation(); // don't also close a surrounding dialog
      } else if (e.key === "Tab") {
        close();
        return;
      } else if (e.key.length === 1) {
        // type to jump: "ma" → Malayalam
        typed = (Date.now() - typedAt > 700 ? "" : typed) + e.key.toLowerCase();
        typedAt = Date.now();
        const hit = opts().findIndex((o) => !o.disabled && o.textContent.trim().toLowerCase().startsWith(typed));
        if (hit >= 0) setActive(hit);
      } else return;
      e.preventDefault();
    };
    btn.addEventListener("blur", () => setTimeout(() => document.activeElement !== btn && close(), 0));
    sync();
  }

  document.addEventListener("pointerdown", (e) => {
    if (openOne && !e.target.closest(".cs-list, .cs")) openOne();
  });
  addEventListener("resize", () => openOne && openOne());
  addEventListener("scroll", (e) => openOne && !(e.target.closest && e.target.closest(".cs-list")) && openOne(), true);

  document.querySelectorAll("select").forEach(enhance);
})();
