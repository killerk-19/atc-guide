"use strict";

// Lock screen. The app code and the data ship only as js/../vault.bin, encrypted with AES-GCM; the
// key is PBKDF2(username + password). Nothing readable is served, so a visitor without the
// credentials sees this form and nothing else. "Remember" keeps the derived key in IndexedDB as a
// non-extractable CryptoKey, so this device opens straight away while the password is not stored.

(function () {
  const SALT = Uint8Array.from(atob("zqyYm6eYiDqkrASqHecVxg=="), (c) => c.charCodeAt(0));
  const ITERATIONS = 600000;
  const MAGIC = "ATCV1";
  const IDB_NAME = "atcg-lock";

  const $ = (id) => document.getElementById(id);
  const text = new TextEncoder();

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("k");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idb(mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("k", mode);
      const out = fn(tx.objectStore("k"));
      tx.oncomplete = () => { db.close(); resolve(out && out.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
  const rememberKey = (key) => idb("readwrite", (s) => s.put(key, "key")).catch(() => {});
  const forgetKey = () => idb("readwrite", (s) => s.delete("key")).catch(() => {});
  const recalledKey = () => idb("readonly", (s) => s.get("key")).catch(() => null);

  async function deriveKey(user, password) {
    const base = await crypto.subtle.importKey(
      "raw", text.encode(user.trim().toLowerCase() + "\n" + password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: SALT, iterations: ITERATIONS, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  }

  async function decrypt(key, buf) {
    const bytes = new Uint8Array(buf);
    if (new TextDecoder().decode(bytes.slice(0, MAGIC.length)) !== MAGIC) throw new Error("format");
    const iv = bytes.slice(MAGIC.length, MAGIC.length + 12);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, bytes.slice(MAGIC.length + 12));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  function start(files) {
    globalThis.ATCG_FILES = files;
    const app = files["js/app.js"];
    delete files["js/app.js"];
    document.documentElement.classList.remove("locked");
    $("lock").hidden = true;
    const url = URL.createObjectURL(new Blob([app], { type: "text/javascript" }));
    const s = document.createElement("script");
    s.src = url;
    s.onload = () => URL.revokeObjectURL(url);
    document.body.appendChild(s);
  }

  function say(msg) { $("lock-msg").textContent = msg; }

  async function init() {
    if (!window.crypto || !crypto.subtle) {
      say("הדפדפן הזה לא תומך בפתיחה מאובטחת. פתחו את האתר ב-HTTPS בדפדפן עדכני.");
      return;
    }
    let vault;
    try {
      const res = await fetch("vault.bin", { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      vault = await res.arrayBuffer();
    } catch {
      say("לא הצלחתי לטעון את האתר. בדקו חיבור ונסו לרענן.");
      return;
    }

    const saved = await recalledKey();
    if (saved) {
      try { start(await decrypt(saved, vault)); return; } catch { await forgetKey(); }
    }

    $("lock-form").hidden = false;
    $("lock-user").focus();
    $("lock-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("lock-go");
      btn.disabled = true;
      say("בודק…");
      try {
        const key = await deriveKey($("lock-user").value, $("lock-pass").value);
        const files = await decrypt(key, vault);
        if ($("lock-remember").checked) await rememberKey(key);
        $("lock-pass").value = "";
        start(files);
      } catch {
        say("שם המשתמש או הסיסמה שגויים.");
        btn.disabled = false;
      }
    });
  }

  document.addEventListener("click", async (e) => {
    if (e.target.closest("#logout")) { await forgetKey(); location.reload(); }
  });

  init();
})();
