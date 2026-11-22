(function () {
      // ---------- ตั้งค่าเวอร์ชันและแหล่งอัปเดต ----------
      // เมื่อออกเวอร์ชันใหม่: เพิ่มเลข APP_VERSION ที่นี่ และแก้ "version" ใน version.json ให้ตรงกัน แล้ว push ขึ้น GitHub
      const APP_VERSION = "1.1.3";
      const UPDATE_REPO = "farmfoodmart-lab/Procurement";   // ชื่อบัญชี/ชื่อ repository บน GitHub
      const UPDATE_BRANCH = "main";

      const fileInput = document.getElementById("file-input");
      const chooseButton = document.getElementById("choose-file");
      const dropzone = document.getElementById("dropzone");
      const minimumFilter = document.getElementById("minimum-filter");
      const warehouseFilter = document.getElementById("warehouse-filter");
      const itemSearch = document.getElementById("item-search");
      const stockSort = document.getElementById("stock-sort");
      const hasMinimumToggle = document.getElementById("has-minimum-toggle");
      const belowMinimumToggle = document.getElementById("below-minimum-toggle");
      const itemsBody = document.getElementById("items-body");
      const itemsTable = document.getElementById("items-table");
      const emptyState = document.getElementById("empty-state");
      const copyButton = document.getElementById("copy-button");
      const itemCount = document.getElementById("item-count");
      const fileStatus = document.getElementById("file-status");
      const toast = document.getElementById("toast");
      const checkButton = document.getElementById("check-update");
      const updatePanel = document.getElementById("update-panel");
      const updateTitle = document.getElementById("update-title");
      const updateSummary = document.getElementById("update-summary");
      const updateApply = document.getElementById("update-apply");
      const updateDismiss = document.getElementById("update-dismiss");
      const productsButton = document.getElementById("products-button");
      const productsDialog = document.getElementById("products-dialog");
      const productsForm = document.getElementById("products-form");
      const productsList = document.getElementById("products-list");
      const productsSearch = document.getElementById("products-search");
      const productsMeta = document.getElementById("products-meta");
      const productsSave = document.getElementById("products-save");
      const productsImport = document.getElementById("products-import");
      const productsFile = document.getElementById("products-file");
      const productsClear = document.getElementById("products-clear");
      const MINIMUMS_KEY = "procurement-minimums";   // ที่เก็บเดิมในเครื่อง (ใช้ย้ายข้อมูลขึ้น Firestore)
      const PRODUCTS_COLLECTION = "products";
      const FIREBASE_CONFIG = {
        apiKey: "AIzaSyB6uQxZ9alqSbq3WkI3SBeagvA4b-WaRS8",
        authDomain: "procurement-c58c0.firebaseapp.com",
        projectId: "procurement-c58c0",
        storageBucket: "procurement-c58c0.firebasestorage.app",
        messagingSenderId: "254849700239",
        appId: "1:254849700239:web:7f7e6c61b15a6237d4bbfa",
        measurementId: "G-ZY7VGFRRRN"
      };
      let db = null;
      let cloudReady = false;
      let minimumsCache = {};
      let allItems = [];
      let toastTimer;
      let pendingRelease = null;

      document.getElementById("app-version").textContent = "v" + APP_VERSION;

      function showToast(message, isError) {
        window.clearTimeout(toastTimer);
        toast.textContent = message;
        toast.classList.toggle("error", Boolean(isError));
        toast.classList.add("show");
        toastTimer = window.setTimeout(function () { toast.classList.remove("show"); }, 3200);
      }

      function cellText(value) {
        if (value === null || value === undefined) return "";
        return String(value).trim();
      }

      // ---------- จำนวนขั้นต่ำที่กำหนดเองต่อสินค้า (เก็บใน Firebase Firestore) ----------
      // แต่ละสินค้าเป็น 1 เอกสารในคอลเลกชัน "products" : { name, minimum, updatedAt }

      function loadMinimums() {
        return Object.assign({}, minimumsCache);
      }

      function productDocId(name) {
        return encodeURIComponent(name);
      }

      function refreshMinimumViews() {
        applyMinimums();
        if (allItems.length === 0) return;
        fillFilter(minimumFilter, allItems.map(function (item) { return item.minimum; }), minimumFilter.value);
        updateWarehouseOptions();
        renderItems();
      }

      function isNumeric(text) {
        return /^-?\d[\d,]*(\.\d+)?$/.test(String(text).trim());
      }

      // อ่านค่าที่บันทึกในเครื่อง และล้างค่าที่ไม่ใช่ตัวเลขทิ้ง (เช่น จากการนำเข้าไฟล์ผิด)
      function readLocalMinimums() {
        try {
          const data = JSON.parse(localStorage.getItem(MINIMUMS_KEY) || "{}");
          if (!data || typeof data !== "object") return {};
          const clean = {};
          Object.keys(data).forEach(function (name) {
            if (isNumeric(data[name])) clean[name] = String(data[name]).trim();
          });
          if (Object.keys(clean).length !== Object.keys(data).length) {
            if (Object.keys(clean).length) localStorage.setItem(MINIMUMS_KEY, JSON.stringify(clean));
            else localStorage.removeItem(MINIMUMS_KEY);
          }
          return clean;
        } catch (error) { return {}; }
      }

      // ย้ายค่าที่เคยบันทึกไว้ในเครื่อง (เวอร์ชันก่อน) ขึ้น Firestore ครั้งเดียว
      async function migrateLocalMinimums() {
        const local = readLocalMinimums();
        const names = Object.keys(local).filter(function (name) {
          return !Object.prototype.hasOwnProperty.call(minimumsCache, name) && String(local[name]).trim() !== "";
        });
        try {
          if (names.length > 0) {
            const batch = db.batch();
            names.forEach(function (name) {
              batch.set(db.collection(PRODUCTS_COLLECTION).doc(productDocId(name)), {
                name: name,
                minimum: String(local[name]).trim(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
              });
            });
            await batch.commit();
          }
          localStorage.removeItem(MINIMUMS_KEY);
        } catch (error) { /* ลองใหม่ครั้งหน้าที่เปิดโปรแกรม */ }
      }

      function initCloud() {
        // ใช้ค่าที่บันทึกไว้ในเครื่องก่อน ระหว่างรอ (หรือเมื่อเชื่อมต่อ) ฐานข้อมูลออนไลน์ไม่ได้
        minimumsCache = readLocalMinimums();
        if (!window.firebase || !firebase.firestore) {
          showToast("โหลด Firebase ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต", true);
          return;
        }
        firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.firestore();
        let migrated = false;
        db.collection(PRODUCTS_COLLECTION).onSnapshot(function (snapshot) {
          const next = {};
          snapshot.forEach(function (doc) {
            const data = doc.data();
            if (data && typeof data.name === "string" && isNumeric(data.minimum)) {
              next[data.name] = String(data.minimum);
            }
          });
          minimumsCache = next;
          cloudReady = true;
          refreshMinimumViews();
          if (!migrated) { migrated = true; migrateLocalMinimums(); }
        }, function (error) {
          cloudReady = false;
          showToast("เชื่อมต่อฐานข้อมูลสินค้าไม่สำเร็จ (" + (error.code || error.message) + ")", true);
        });
      }

      function applyMinimums() {
        const saved = loadMinimums();
        allItems.forEach(function (item) {
          item.minimum = Object.prototype.hasOwnProperty.call(saved, item.name) ? saved[item.name] : item.sheetMinimum;
        });
      }

      function updateProductsMeta() {
        const inputs = Array.from(productsList.querySelectorAll(".product-input"));
        const custom = inputs.filter(function (input) { return input.value.trim() !== ""; }).length;
        productsMeta.textContent = inputs.length + " สินค้า · กำหนดเอง " + custom + " รายการ";
      }

      function createProductRow(product, savedValue) {
        const row = document.createElement("label");
        const name = document.createElement("span");
        const hint = document.createElement("small");
        const input = document.createElement("input");
        const unit = document.createElement("span");
        const hasSaved = savedValue !== undefined;
        row.className = "product-row";
        row.dataset.search = product.name.toLowerCase();
        name.className = "product-name";
        name.textContent = product.name;
        hint.textContent = product.hint || (product.missing
          ? "ไม่อยู่ในไฟล์ปัจจุบัน"
          : "");
        if (hint.textContent) name.appendChild(hint);
        input.className = "product-input";
        input.type = "text";
        input.inputMode = "decimal";
        input.dataset.name = product.name;
        input.placeholder = product.sheetMinimum || "-";
        input.value = hasSaved ? savedValue : "";
        input.classList.toggle("custom", hasSaved && savedValue !== "");
        input.setAttribute("aria-label", "จำนวนขั้นต่ำของ " + product.name);
        input.addEventListener("input", function () {
          input.classList.toggle("custom", input.value.trim() !== "");
          updateProductsMeta();
        });
        unit.className = "product-unit";
        unit.textContent = product.unit || "";
        row.append(name, input, unit);
        return row;
      }

      // ---------- ยืนยันตัวตนก่อนแก้ไขข้อมูลจำนวนขั้นต่ำ (นำเข้า / ลบข้อมูล / บันทึก) ----------
      // ยืนยันครั้งเดียวต่อการเปิดหน้าต่าง สินค้า หนึ่งครั้ง ปิดหน้าต่างแล้วต้องยืนยันใหม่
      const AUTH_USERNAME = "admin";
      const AUTH_PASSWORD = "seniorsoftmaxx";
      const authDialog = document.getElementById("auth-dialog");
      const authForm = document.getElementById("auth-form");
      const authUsername = document.getElementById("auth-username");
      const authPassword = document.getElementById("auth-password");
      const authError = document.getElementById("auth-error");
      const authReason = document.getElementById("auth-reason");
      let productsAuthorized = false;
      let authResolve = null;

      function finishAuth(ok) {
        if (ok) productsAuthorized = true;
        const resolve = authResolve;
        authResolve = null;
        if (authDialog.open) authDialog.close();
        if (resolve) resolve(ok);
      }

      function requireAuth(actionLabel) {
        if (productsAuthorized) return Promise.resolve(true);
        if (authResolve) authResolve(false);
        authForm.reset();
        authError.textContent = "";
        authReason.textContent = "กรุณาใส่ชื่อผู้ใช้และรหัสผ่านเพื่อ" + actionLabel;
        authDialog.showModal();
        authUsername.focus();
        return new Promise(function (resolve) { authResolve = resolve; });
      }

      authForm.addEventListener("submit", function (event) {
        event.preventDefault();
        if (authUsername.value.trim() === AUTH_USERNAME && authPassword.value === AUTH_PASSWORD) {
          finishAuth(true);
        } else {
          authError.textContent = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
          authPassword.value = "";
          authPassword.focus();
        }
      });
      document.getElementById("auth-cancel").addEventListener("click", function () { finishAuth(false); });
      document.getElementById("auth-close").addEventListener("click", function () { finishAuth(false); });
      authDialog.addEventListener("close", function () { if (authResolve) finishAuth(false); });

      function openProducts() {
        productsAuthorized = false;
        renderProductsList();
        productsDialog.showModal();
        productsSearch.focus();
      }

      // ลบข้อมูลทั้งหมด: จำนวนขั้นต่ำทุกรายการ (ฐานข้อมูลออนไลน์และในเครื่อง) และรายชื่อ/ลำดับที่นำเข้า
      async function clearProducts() {
        if (!(await requireAuth("ลบข้อมูล"))) return;
        const names = Object.keys(loadMinimums());
        if (!window.confirm("ลบจำนวนขั้นต่ำทั้งหมด " + names.length + " รายการ และรายชื่อที่นำเข้าจากไฟล์?\nการลบนี้ย้อนกลับไม่ได้")) return;
        if (names.length > 0 && (!db || !cloudReady)) {
          showToast("ลบไม่สำเร็จ: ยังเชื่อมต่อฐานข้อมูลออนไลน์ไม่ได้", true);
          return;
        }
        productsClear.disabled = true;
        try {
          for (let start = 0; start < names.length; start += 450) {
            const batch = db.batch();
            names.slice(start, start + 450).forEach(function (name) {
              batch.delete(db.collection(PRODUCTS_COLLECTION).doc(productDocId(name)));
            });
            await batch.commit();
          }
          try {
            localStorage.removeItem(ORDER_KEY);
            localStorage.removeItem(MINIMUMS_KEY);
          } catch (error) { /* ไม่มีที่เก็บในเครื่อง */ }
          minimumsCache = {};
          refreshMinimumViews();
          renderProductsList();
          showToast("ลบข้อมูลแล้ว");
        } catch (error) {
          showToast("ลบไม่สำเร็จ (" + (error.code || error.message) + ")", true);
        } finally {
          productsClear.disabled = false;
        }
      }

      function renderProductsList() {
        const saved = loadMinimums();
        const order = loadProductOrder();
        const products = new Map();
        // รายชื่อจากไฟล์ที่นำเข้าล่าสุดมาก่อน ใช้ข้อมูล (เช่น หน่วย) จากไฟล์หลักถ้ามี
        order.forEach(function (name) {
          if (typeof name === "string" && name) products.set(name, { name: name, sheetMinimum: "", unit: "" });
        });
        allItems.forEach(function (item) {
          const current = products.get(item.name);
          if (!current || (!current.unit && !current.warehouse)) products.set(item.name, item);
        });
        Object.keys(saved).forEach(function (name) {
          if (!products.has(name)) products.set(name, { name: name, sheetMinimum: "", unit: "", missing: true });
        });

        productsList.replaceChildren();
        productsSearch.value = "";
        if (products.size === 0) {
          const empty = document.createElement("div");
          empty.className = "products-empty";
          empty.textContent = "ยังไม่มีสินค้า กรุณาอัปโหลดไฟล์ Excel ก่อน";
          productsList.appendChild(empty);
        }
        Array.from(products.values())
          .sort(function (a, b) { return a.name.localeCompare(b.name, "th", { numeric: true }); })
          .forEach(function (product) {
            const value = Object.prototype.hasOwnProperty.call(saved, product.name) ? saved[product.name] : undefined;
            productsList.appendChild(createProductRow(product, value));
          });
        sortProductRows(order);
        applyProductsView();
        updateProductsMeta();
      }

      // ---------- สวิตช์ "ตามหน้าแรก": แสดงและเรียงสินค้าในหน้าต่างตามตัวกรองของหน้าแรก ----------
      const productsFollowMain = document.getElementById("products-follow-main");
      const FOLLOW_KEY = "procurement-products-follow-main";
      try { productsFollowMain.checked = localStorage.getItem(FOLLOW_KEY) === "1"; } catch (error) { /* ใช้ค่าเริ่มต้น */ }

      function applyProductsView() {
        const follow = productsFollowMain.checked;
        const query = productsSearch.value.trim().toLowerCase();
        const visible = follow ? getVisibleItems().map(function (item) { return item.name; }) : null;
        const visibleSet = visible ? new Set(visible) : null;
        // เปิด: เรียงตามรายการในหน้าแรก · ปิด: กลับไปเรียงตามไฟล์ที่นำเข้า/ชื่อสินค้า
        if (follow) {
          sortProductRows(visible);
        } else {
          Array.from(productsList.querySelectorAll(".product-row"))
            .sort(function (a, b) { return a.dataset.search.localeCompare(b.dataset.search, "th", { numeric: true }); })
            .forEach(function (row) { productsList.appendChild(row); });
          sortProductRows(loadProductOrder());
        }
        productsList.querySelectorAll(".product-row").forEach(function (row) {
          const name = row.querySelector(".product-input").dataset.name;
          row.hidden = (query !== "" && !row.dataset.search.includes(query))
            || (visibleSet !== null && !visibleSet.has(name));
        });
      }

      // ---------- นำเข้าจำนวนขั้นต่ำจากไฟล์ Excel (R05.101) ----------
      // นำเข้ารายชื่อสินค้าจากคอลัมน์ B และเรียงรายการในหน้าต่างตามลำดับในไฟล์
      const IMPORT_NAME_COL = 1;    // คอลัมน์ B
      const IMPORT_MIN_COL = 25;    // คอลัมน์ Z
      const ORDER_KEY = "procurement-product-order";   // รายชื่อ/ลำดับสินค้าตามไฟล์ที่นำเข้าล่าสุด (จำไว้ในเครื่อง)

      function loadProductOrder() {
        try {
          const order = JSON.parse(localStorage.getItem(ORDER_KEY) || "[]");
          return Array.isArray(order) ? order : [];
        } catch (error) { return []; }
      }

      function saveProductOrder(order) {
        try { localStorage.setItem(ORDER_KEY, JSON.stringify(order)); } catch (error) { /* ไม่จำก็ได้ */ }
      }

      // เรียงแถวในหน้าต่างตามลำดับที่ให้มา ชื่อที่ไม่อยู่ในลำดับจะต่อท้ายโดยคงลำดับเดิม
      function sortProductRows(order) {
        const rank = new Map();
        order.forEach(function (name, index) { if (!rank.has(name)) rank.set(name, index); });
        Array.from(productsList.querySelectorAll(".product-row"))
          .map(function (row, index) { return { row: row, index: index, name: row.querySelector(".product-input").dataset.name }; })
          .sort(function (a, b) {
            const ra = rank.has(a.name) ? rank.get(a.name) : Infinity;
            const rb = rank.has(b.name) ? rank.get(b.name) : Infinity;
            if (ra !== rb) return ra - rb;
            return a.index - b.index;
          })
          .forEach(function (item) { productsList.appendChild(item.row); });
      }

      function importMinimums(file) {
        if (!window.XLSX) {
          showToast("ไม่สามารถโหลดตัวอ่าน Excel ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง", true);
          return;
        }
        if (!file || !/\.(xlsx|xls)$/i.test(file.name)) {
          showToast("กรุณาเลือกไฟล์ Excel นามสกุล .xlsx หรือ .xls", true);
          return;
        }
        const reader = new FileReader();
        reader.onerror = function () { showToast("อ่านไฟล์ไม่สำเร็จ กรุณาลองเลือกไฟล์อีกครั้ง", true); };
        reader.onload = function (event) {
          try {
            const workbook = XLSX.read(event.target.result, { type: "array" });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            if (!sheet) throw new Error("no sheet");
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
            // อ่านรายชื่อสินค้าจากคอลัมน์ B และจำนวนขั้นต่ำจากคอลัมน์ Z ตั้งแต่แถวที่ 2 ตามลำดับในไฟล์
            // Z เป็นตัวเลข = ใช้ค่านั้น · Z ว่าง/ไม่ใช่ตัวเลข = ไม่มีจำนวนขั้นต่ำ (แสดง -)
            const names = [];
            const minimums = new Map();
            rows.slice(1).forEach(function (row) {
              const name = cellText(row[IMPORT_NAME_COL]);
              if (!name || minimums.has(name)) return;
              const value = cellText(row[IMPORT_MIN_COL]).replace(/,/g, "");
              names.push(name);
              minimums.set(name, isNumeric(value) ? value : "");
            });
            if (names.length === 0) {
              showToast("ไม่พบรายชื่อสินค้าในคอลัมน์ B ตั้งแต่แถวที่ 2 เป็นต้นไป", true);
              return;
            }

            const inputs = new Map();
            productsList.querySelectorAll(".product-input").forEach(function (input) { inputs.set(input.dataset.name, input); });
            const emptyNote = productsList.querySelector(".products-empty");
            if (emptyNote) emptyNote.remove();
            let added = 0;
            let changed = 0;
            names.forEach(function (name) {
              let input = inputs.get(name);
              if (!input) {
                const row = createProductRow({ name: name, sheetMinimum: "", unit: "" }, undefined);
                productsList.appendChild(row);
                input = row.querySelector(".product-input");
                added += 1;
              }
              const value = minimums.get(name);
              if (input.value.trim() !== value) changed += 1;
              input.value = value;   // ค่าว่างจะแสดง - และถูกลบค่าเดิมออกเมื่อกด บันทึก
              input.classList.toggle("custom", value !== "");
            });
            // จำรายชื่อและลำดับไว้ทันที แล้วเรียงตามไฟล์ (สินค้าที่ไม่อยู่ในไฟล์ต่อท้าย)
            saveProductOrder(names);
            sortProductRows(names);
            productsList.scrollTop = 0;
            productsSearch.dispatchEvent(new Event("input"));
            updateProductsMeta();
            showToast("นำเข้า " + names.length + " รายการ เรียงตามไฟล์แล้ว" + (added ? " (เพิ่มใหม่ " + added + ")" : "")
              + (changed ? " · จำนวนขั้นต่ำเปลี่ยน " + changed + " รายการ กด บันทึก เพื่อยืนยัน" : ""));
          } catch (error) {
            showToast("อ่านข้อมูลจากไฟล์ไม่ได้ กรุณาตรวจสอบรูปแบบไฟล์", true);
          }
        };
        reader.readAsArrayBuffer(file);
      }

      async function saveProducts(event) {
        event.preventDefault();
        const saved = loadMinimums();
        const changes = [];
        productsList.querySelectorAll(".product-input").forEach(function (input) {
          const name = input.dataset.name;
          const value = input.value.trim();
          const had = Object.prototype.hasOwnProperty.call(saved, name);
          if (value === "" && had) changes.push({ name: name, remove: true });
          else if (value !== "" && saved[name] !== value) changes.push({ name: name, value: value });
        });
        if (changes.length === 0) {
          productsDialog.close();
          return;
        }
        if (!(await requireAuth("บันทึกข้อมูล"))) return;

        if (!db || !cloudReady) {
          // เชื่อมต่อฐานข้อมูลออนไลน์ไม่ได้: บันทึกไว้ในเครื่องก่อน แล้วจะอัปโหลดอัตโนมัติเมื่อเชื่อมต่อได้
          changes.forEach(function (change) {
            if (change.remove) delete saved[change.name];
            else saved[change.name] = change.value;
          });
          try {
            localStorage.setItem(MINIMUMS_KEY, JSON.stringify(saved));
          } catch (error) {
            showToast("บันทึกไม่สำเร็จ: เชื่อมต่อฐานข้อมูลไม่ได้ และบันทึกในเครื่องไม่ได้", true);
            return;
          }
          minimumsCache = saved;
          refreshMinimumViews();
          productsDialog.close();
          showToast("บันทึก " + changes.length + " รายการไว้ในเครื่อง (ยังเชื่อมต่อฐานข้อมูลออนไลน์ไม่ได้)", true);
          return;
        }

        productsSave.disabled = true;
        productsSave.textContent = "กำลังบันทึก...";
        try {
          // Firestore จำกัด 500 รายการต่อ batch
          for (let start = 0; start < changes.length; start += 450) {
            const batch = db.batch();
            changes.slice(start, start + 450).forEach(function (change) {
              const ref = db.collection(PRODUCTS_COLLECTION).doc(productDocId(change.name));
              if (change.remove) batch.delete(ref);
              else batch.set(ref, {
                name: change.name,
                minimum: change.value,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
              });
            });
            await batch.commit();
          }
          productsDialog.close();
          showToast("บันทึกจำนวนขั้นต่ำ " + changes.length + " รายการแล้ว");
        } catch (error) {
          showToast("บันทึกไม่สำเร็จ (" + (error.code || error.message) + ")", true);
        } finally {
          productsSave.disabled = false;
          productsSave.textContent = "บันทึก";
        }
      }

      function getVisibleItems() {
        const selectedMinimum = minimumFilter.value;
        const selectedWarehouse = warehouseFilter.value;
        const query = itemSearch.value.trim().toLowerCase();
        const onlyWithMinimum = hasMinimumToggle.checked;
        const filtered = allItems.filter(function (item) {
          return (!query || item.name.toLowerCase().includes(query))
            && (!onlyWithMinimum || isNumeric(item.minimum))
            && (!selectedMinimum || item.minimum === selectedMinimum)
            && (!selectedWarehouse || item.warehouse === selectedWarehouse);
        });
        let result = selectedWarehouse ? filtered : mergeByName(filtered);
        // กรองหลังรวมคลัง เพื่อเทียบยอดคงเหลือรวมกับจำนวนขั้นต่ำ
        if (belowMinimumToggle.checked) result = result.filter(isBelowMinimum);
        if (stockSort.value) {
          const direction = stockSort.value === "asc" ? 1 : -1;
          result.sort(function (a, b) { return (parseNumber(a.stock) - parseNumber(b.stock)) * direction; });
        }
        return result;
      }

      function isBelowMinimum(item) {
        return isNumeric(item.minimum) && parseNumber(item.stock) < parseNumber(item.minimum);
      }

      function parseNumber(text) {
        const value = parseFloat(String(text).replace(/,/g, ""));
        return Number.isFinite(value) ? value : 0;
      }

      function formatNumber(value) {
        return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
      }

      // คลัง "ทั้งหมด": รวมสินค้าชื่อเดียวกันจากทุกคลังเป็นรายการเดียว และรวมจำนวนคงเหลือ
      function mergeByName(items) {
        const merged = new Map();
        items.forEach(function (item) {
          const existing = merged.get(item.name);
          if (!existing) {
            merged.set(item.name, Object.assign({}, item, { stockTotal: parseNumber(item.stock), count: 1 }));
            return;
          }
          existing.stockTotal += parseNumber(item.stock);
          existing.count += 1;
          if (!existing.unit && item.unit) existing.unit = item.unit;
        });
        return Array.from(merged.values()).map(function (item) {
          if (item.count > 1) item.stock = formatNumber(item.stockTotal);
          return item;
        });
      }

      function fillFilter(select, values, keepValue) {
        const options = Array.from(new Set(values.filter(Boolean)))
          .sort(function (a, b) {
            if (select === warehouseFilter) {
              // ให้คลัง "หน้าร้าน" ขึ้นก่อนเสมอ
              const pa = a.includes("หน้าร้าน") ? 0 : 1;
              const pb = b.includes("หน้าร้าน") ? 0 : 1;
              if (pa !== pb) return pa - pb;
            }
            return a.localeCompare(b, "th", { numeric: true });
          });
        select.replaceChildren(new Option("ทั้งหมด", ""));
        options.forEach(function (value) { select.add(new Option(value, value)); });
        select.disabled = options.length === 0;
        select.value = keepValue && options.includes(keepValue) ? keepValue : "";
      }

      function updateWarehouseOptions() {
        const selectedMinimum = minimumFilter.value;
        const warehouses = allItems
          .filter(function (item) { return !selectedMinimum || item.minimum === selectedMinimum; })
          .map(function (item) { return item.warehouse; });
        fillFilter(warehouseFilter, warehouses, warehouseFilter.value);
      }

      function renderItems() {
        const visibleItems = getVisibleItems();
        itemsBody.replaceChildren();
        itemCount.textContent = String(visibleItems.length);
        itemsTable.hidden = visibleItems.length === 0;
        emptyState.hidden = visibleItems.length > 0;
        emptyState.querySelector("strong").textContent = allItems.length
          ? "ไม่พบสินค้าที่ตรงกับการค้นหา" : "ยังไม่มีรายการสินค้า";
        emptyState.querySelector("p").textContent = allItems.length
          ? "ลองเปลี่ยนคำค้นหาหรือตัวกรอง" : "อัปโหลดไฟล์ Excel เพื่อเริ่มต้นใช้งาน";
        copyButton.disabled = visibleItems.length === 0;

        visibleItems.forEach(function (item, index) {
          const row = document.createElement("tr");
          const numberCell = document.createElement("td");
          const nameCell = document.createElement("td");
          const minimumCell = document.createElement("td");
          const stockCell = document.createElement("td");
          const unitCell = document.createElement("td");
          const minimumTag = document.createElement("span");

          numberCell.textContent = String(index + 1).padStart(2, "0");
          nameCell.className = "item-name";
          nameCell.textContent = item.name;
          minimumTag.className = "minimum-chip";
          minimumTag.textContent = item.minimum || "-";
          minimumCell.appendChild(minimumTag);
          stockCell.className = "stock";
          stockCell.textContent = item.stock || "0";
          // คงเหลือต่ำกว่าจำนวนขั้นต่ำ = ตัวเลขสีแดง
          if (isBelowMinimum(item)) {
            stockCell.classList.add("low");
            stockCell.title = "ต่ำกว่าจำนวนขั้นต่ำ (" + item.minimum + ")";
          }
          unitCell.textContent = item.unit;
          row.append(numberCell, nameCell, stockCell, unitCell, minimumCell);
          itemsBody.appendChild(row);
        });
      }

      function readWorkbook(file) {
        if (!window.XLSX) {
          showToast("ไม่สามารถโหลดตัวอ่าน Excel ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง", true);
          return;
        }
        if (!file || !/\.(xlsx|xls)$/i.test(file.name)) {
          showToast("กรุณาเลือกไฟล์ Excel นามสกุล .xlsx หรือ .xls", true);
          return;
        }

        const reader = new FileReader();
        reader.onerror = function () { showToast("อ่านไฟล์ไม่สำเร็จ กรุณาลองเลือกไฟล์อีกครั้ง", true); };
        reader.onload = function (event) {
          try {
            const workbook = XLSX.read(event.target.result, { type: "array" });
            const sheetName = workbook.SheetNames[0];
            if (!sheetName) throw new Error("ไม่พบแผ่นงานในไฟล์");
            const sheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
            const parsedItems = rows.slice(1).map(function (row) {
              return {
                name: cellText(row[5]),
                sheetMinimum: "",   // ไฟล์หลักไม่มีคอลัมน์จำนวนขั้นต่ำ (คอลัมน์ C คือชื่อสาขา) ใช้ค่าจากปุ่ม สินค้า แทน
                stock: cellText(row[6]),
                warehouse: cellText(row[3]),
                unit: cellText(row[7])
              };
            }).filter(function (item) { return item.name !== ""; });
            if (parsedItems.length === 0) {
              showToast("ไม่พบรายการในคอลัมน์ F ตั้งแต่แถวที่ 2 เป็นต้นไป", true);
              return;
            }

            allItems = parsedItems;
            itemSearch.disabled = false;
            stockSort.disabled = false;
            hasMinimumToggle.disabled = false;
            belowMinimumToggle.disabled = false;
            applyMinimums();
            fillFilter(minimumFilter, allItems.map(function (item) { return item.minimum; }));
            fillFilter(warehouseFilter, parsedItems.map(function (item) { return item.warehouse; }));
            renderItems();
            document.getElementById("file-name").textContent = file.name;
            document.getElementById("file-summary").textContent =
              "อัปโหลดสำเร็จ · " + parsedItems.length + " รายการ · แผ่นงาน " + sheetName;
            fileStatus.classList.add("visible");
            showToast("อัปโหลดไฟล์สำเร็จ");
          } catch (error) {
            showToast("อ่านข้อมูลจากไฟล์ไม่ได้ กรุณาตรวจสอบรูปแบบไฟล์และคอลัมน์ D, F, G, H", true);
          }
        };
        reader.readAsArrayBuffer(file);
      }

      // ---------- อัปเดตเวอร์ชันโปรแกรม ----------

      function rawUrl(path) {
        return "https://raw.githubusercontent.com/" + UPDATE_REPO + "/" + UPDATE_BRANCH + "/"
          + path.split("/").map(encodeURIComponent).join("/");
      }

      function compareVersions(a, b) {
        const pa = String(a).split(".").map(function (n) { return parseInt(n, 10) || 0; });
        const pb = String(b).split(".").map(function (n) { return parseInt(n, 10) || 0; });
        for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
          const diff = (pa[i] || 0) - (pb[i] || 0);
          if (diff !== 0) return diff > 0 ? 1 : -1;
        }
        return 0;
      }

      function isSafePath(path) {
        return typeof path === "string" && path !== "" && !path.startsWith("/")
          && !path.includes("\\") && path.split("/").every(function (part) { return part && part !== "." && part !== ".."; });
      }

      function hideUpdatePanel() {
        pendingRelease = null;
        updatePanel.hidden = true;
      }

      function setChecking(isChecking) {
        checkButton.classList.toggle("checking", isChecking);
        checkButton.disabled = isChecking;
      }

      async function checkForUpdates() {
        if (!UPDATE_REPO) {
          showToast("ยังไม่ได้ตั้งค่าแหล่งอัปเดต (UPDATE_REPO ใน app.js)", true);
          return;
        }
        setChecking(true);
        try {
          const response = await fetch(rawUrl("version.json") + "?t=" + Date.now(), { cache: "no-store" });
          if (!response.ok) throw new Error("ไม่พบข้อมูลเวอร์ชันบน GitHub (" + response.status + ")");
          const release = await response.json();
          if (!release || !release.version) throw new Error("ข้อมูลเวอร์ชันบน GitHub ไม่ถูกต้อง");
          if (compareVersions(release.version, APP_VERSION) <= 0) {
            hideUpdatePanel();
            showToast("คุณใช้เวอร์ชันล่าสุดแล้ว (v" + APP_VERSION + ")");
            return;
          }
          pendingRelease = release;
          updateTitle.textContent = "มีเวอร์ชันใหม่ v" + release.version;
          updateSummary.textContent = "เวอร์ชันปัจจุบัน v" + APP_VERSION + (release.notes ? " · " + release.notes : "");
          updatePanel.hidden = false;
          updateApply.focus();
        } catch (error) {
          const offline = error instanceof TypeError;
          showToast(offline ? "เชื่อมต่อ GitHub ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต" : error.message, true);
        } finally {
          setChecking(false);
        }
      }

      // จำโฟลเดอร์โปรแกรมไว้ใน IndexedDB เพื่อครั้งต่อไปไม่ต้องเลือกใหม่
      function withStore(mode, action) {
        return new Promise(function (resolve, reject) {
          const open = indexedDB.open("procurement-updater", 1);
          open.onupgradeneeded = function () { open.result.createObjectStore("handles"); };
          open.onerror = function () { reject(open.error); };
          open.onsuccess = function () {
            const tx = open.result.transaction("handles", mode);
            const request = action(tx.objectStore("handles"));
            tx.oncomplete = function () { resolve(request.result); };
            tx.onerror = function () { reject(tx.error); };
          };
        });
      }

      async function getAppFolder() {
        let folder = null;
        try { folder = await withStore("readonly", function (store) { return store.get("app-folder"); }); } catch (error) { folder = null; }
        if (folder) {
          const permission = await folder.requestPermission({ mode: "readwrite" });
          if (permission === "granted") return folder;
        }
        showToast("เลือกโฟลเดอร์ที่ติดตั้งโปรแกรม (โฟลเดอร์ที่มีไฟล์ Procurement.html)");
        folder = await window.showDirectoryPicker({ id: "procurement-app", mode: "readwrite" });
        try {
          await folder.getFileHandle("Procurement.html");
        } catch (error) {
          throw new Error("โฟลเดอร์นี้ไม่มีไฟล์ Procurement.html กรุณาเลือกโฟลเดอร์ของโปรแกรม");
        }
        try { await withStore("readwrite", function (store) { return store.put(folder, "app-folder"); }); } catch (error) { /* ไม่จำก็ได้ */ }
        return folder;
      }

      async function writeFile(folder, path, data) {
        const parts = path.split("/");
        let dir = folder;
        for (let i = 0; i < parts.length - 1; i += 1) dir = await dir.getDirectoryHandle(parts[i], { create: true });
        const handle = await dir.getFileHandle(parts[parts.length - 1], { create: true });
        const writable = await handle.createWritable();
        await writable.write(data);
        await writable.close();
      }

      async function applyUpdate() {
        const release = pendingRelease;
        if (!release) return;
        const files = Array.isArray(release.files) ? release.files : [];
        if (files.length === 0 || !files.every(isSafePath)) {
          showToast("รายการไฟล์ในเวอร์ชันใหม่ไม่ถูกต้อง", true);
          return;
        }
        if (!window.showDirectoryPicker) {
          // เบราว์เซอร์นี้เขียนไฟล์ลงเครื่องเองไม่ได้ ให้ดาวน์โหลดไฟล์ ZIP ไปแตกทับแทน
          window.open("https://github.com/" + UPDATE_REPO + "/archive/refs/heads/" + UPDATE_BRANCH + ".zip", "_blank");
          showToast("ดาวน์โหลดไฟล์ ZIP แล้วแตกไฟล์ทับโฟลเดอร์โปรแกรมเดิม");
          hideUpdatePanel();
          return;
        }
        updateApply.disabled = true;
        updateDismiss.disabled = true;
        updateApply.textContent = "กำลังอัปเดต...";
        try {
          const folder = await getAppFolder();
          // ดาวน์โหลดครบทุกไฟล์ก่อน ถ้าไฟล์ใดล้มเหลวจะไม่เขียนทับอะไรเลย
          const downloads = await Promise.all(files.map(async function (path) {
            const response = await fetch(rawUrl(path) + "?t=" + Date.now(), { cache: "no-store" });
            if (!response.ok) throw new Error("ดาวน์โหลดไฟล์ " + path + " ไม่สำเร็จ");
            return { path: path, data: await response.blob() };
          }));
          for (const file of downloads) await writeFile(folder, file.path, file.data);
          showToast("อัปเดตเป็น v" + release.version + " แล้ว กำลังเปิดโปรแกรมใหม่...");
          window.setTimeout(function () { window.location.reload(); }, 1200);
        } catch (error) {
          if (error && error.name === "AbortError") showToast("ยกเลิกการอัปเดต");
          else showToast(error && error.message ? error.message : "อัปเดตไม่สำเร็จ", true);
          updateApply.disabled = false;
          updateDismiss.disabled = false;
          updateApply.textContent = "อัปเดตเลย";
        }
      }

      // ---------- เหตุการณ์ ----------

      chooseButton.addEventListener("click", function () { fileInput.click(); });
      fileInput.addEventListener("change", function () {
        if (fileInput.files.length) readWorkbook(fileInput.files[0]);
        fileInput.value = "";
      });
      checkButton.addEventListener("click", checkForUpdates);
      updateApply.addEventListener("click", applyUpdate);
      updateDismiss.addEventListener("click", hideUpdatePanel);
      minimumFilter.addEventListener("change", function () {
        updateWarehouseOptions();
        renderItems();
      });
      warehouseFilter.addEventListener("change", renderItems);
      itemSearch.addEventListener("input", renderItems);
      stockSort.addEventListener("change", renderItems);
      hasMinimumToggle.addEventListener("change", renderItems);
      belowMinimumToggle.addEventListener("change", renderItems);
      initCloud();
      productsButton.addEventListener("click", openProducts);
      productsForm.addEventListener("submit", saveProducts);
      productsImport.addEventListener("click", function () {
        requireAuth("นำเข้าข้อมูล").then(function (ok) { if (ok) productsFile.click(); });
      });
      productsDialog.addEventListener("close", function () { productsAuthorized = false; });
      productsClear.addEventListener("click", clearProducts);
      productsFile.addEventListener("change", function () {
        if (productsFile.files.length) importMinimums(productsFile.files[0]);
        productsFile.value = "";
      });
      document.getElementById("products-close").addEventListener("click", function () { productsDialog.close(); });
      document.getElementById("products-cancel").addEventListener("click", function () { productsDialog.close(); });
      productsSearch.addEventListener("input", applyProductsView);
      productsFollowMain.addEventListener("change", function () {
        try { localStorage.setItem(FOLLOW_KEY, productsFollowMain.checked ? "1" : "0"); } catch (error) { /* ไม่จำก็ได้ */ }
        applyProductsView();
        productsList.scrollTop = 0;
      });
      productsSearch.addEventListener("keydown", function (event) {
        if (event.key === "Enter") event.preventDefault();
      });
      ["dragenter", "dragover"].forEach(function (eventName) {
        dropzone.addEventListener(eventName, function (event) {
          event.preventDefault();
          dropzone.classList.add("dragover");
        });
      });
      ["dragleave", "drop"].forEach(function (eventName) {
        dropzone.addEventListener(eventName, function (event) {
          event.preventDefault();
          dropzone.classList.remove("dragover");
        });
      });
      dropzone.addEventListener("drop", function (event) {
        const file = event.dataTransfer.files[0];
        if (file) readWorkbook(file);
      });
      copyButton.addEventListener("click", async function () {
        const visibleItems = getVisibleItems();
        const text = visibleItems.map(function (item, index) {
          return (index + 1) + ". " + item.name + "   " + (item.stock || "0") + (item.unit ? " " + item.unit : "");
        }).join("\n");
        try {
          await navigator.clipboard.writeText(text);
          showToast("คัดลอกรายการ " + visibleItems.length + " รายการแล้ว");
        } catch (error) {
          const textArea = document.createElement("textarea");
          textArea.value = text;
          textArea.style.position = "fixed";
          textArea.style.opacity = "0";
          document.body.appendChild(textArea);
          textArea.select();
          const copied = document.execCommand("copy");
          textArea.remove();
          if (copied) showToast("คัดลอกรายการ " + visibleItems.length + " รายการแล้ว");
          else showToast("คัดลอกไม่สำเร็จ กรุณาลองอีกครั้ง", true);
        }
      });
    })();
