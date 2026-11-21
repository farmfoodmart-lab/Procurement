(function () {
      // ---------- ตั้งค่าเวอร์ชันและแหล่งอัปเดต ----------
      // เมื่อออกเวอร์ชันใหม่: เพิ่มเลข APP_VERSION ที่นี่ และแก้ "version" ใน version.json ให้ตรงกัน แล้ว push ขึ้น GitHub
      const APP_VERSION = "1.0.0";
      const UPDATE_REPO = "farmfoodmart-lab/Procurement";   // ชื่อบัญชี/ชื่อ repository บน GitHub
      const UPDATE_BRANCH = "main";

      const fileInput = document.getElementById("file-input");
      const chooseButton = document.getElementById("choose-file");
      const dropzone = document.getElementById("dropzone");
      const minimumFilter = document.getElementById("minimum-filter");
      const vendorFilter = document.getElementById("vendor-filter");
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

      function getVisibleItems() {
        const selectedMinimum = minimumFilter.value;
        const selectedVendor = vendorFilter.value;
        return allItems.filter(function (item) {
          return (!selectedMinimum || item.minimum === selectedMinimum)
            && (!selectedVendor || item.vendor === selectedVendor);
        });
      }

      function fillFilter(select, values, keepValue) {
        const options = Array.from(new Set(values.filter(Boolean)))
          .sort(function (a, b) { return a.localeCompare(b, "th", { numeric: true }); });
        select.replaceChildren(new Option("ทั้งหมด", ""));
        options.forEach(function (value) { select.add(new Option(value, value)); });
        select.disabled = options.length === 0;
        select.value = keepValue && options.includes(keepValue) ? keepValue : "";
      }

      function updateVendorOptions() {
        const selectedMinimum = minimumFilter.value;
        const vendors = allItems
          .filter(function (item) { return !selectedMinimum || item.minimum === selectedMinimum; })
          .map(function (item) { return item.vendor; });
        fillFilter(vendorFilter, vendors, vendorFilter.value);
      }

      function renderItems() {
        const visibleItems = getVisibleItems();
        itemsBody.replaceChildren();
        itemCount.textContent = String(visibleItems.length);
        itemsTable.hidden = visibleItems.length === 0;
        emptyState.hidden = visibleItems.length > 0;
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
          minimumTag.textContent = item.minimum || "ไม่ระบุ";
          minimumCell.appendChild(minimumTag);
          stockCell.className = "stock";
          stockCell.textContent = item.stock || "0";
          unitCell.textContent = item.unit;
          row.append(numberCell, nameCell, minimumCell, stockCell, unitCell);
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
                name: cellText(row[1]),
                minimum: cellText(row[2]),
                stock: cellText(row[16]),
                vendor: cellText(row[20]),
                unit: cellText(row[21])
              };
            }).filter(function (item) { return item.name !== ""; });
            if (parsedItems.length === 0) {
              showToast("ไม่พบรายการในคอลัมน์ B ตั้งแต่แถวที่ 2 เป็นต้นไป", true);
              return;
            }

            allItems = parsedItems;
            fillFilter(minimumFilter, parsedItems.map(function (item) { return item.minimum; }));
            fillFilter(vendorFilter, parsedItems.map(function (item) { return item.vendor; }));
            renderItems();
            document.getElementById("file-name").textContent = file.name;
            document.getElementById("file-summary").textContent =
              "อัปโหลดสำเร็จ · " + parsedItems.length + " รายการ · แผ่นงาน " + sheetName;
            fileStatus.classList.add("visible");
            showToast("อัปโหลดไฟล์สำเร็จ");
          } catch (error) {
            showToast("อ่านข้อมูลจากไฟล์ไม่ได้ กรุณาตรวจสอบรูปแบบไฟล์และคอลัมน์ B, C, Q, U", true);
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
        updateVendorOptions();
        renderItems();
      });
      vendorFilter.addEventListener("change", renderItems);
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
