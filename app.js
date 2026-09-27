"use strict";

const LEGACY_STORAGE_KEY = "local-product-manager-v1";
const MAX_NUMBER = 999999999;
const LOW_STOCK_THRESHOLD = 5;
const currency = new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 });
const config = window.SUPABASE_CONFIG;
const database = config?.url && config?.publishableKey && window.supabase
  ? window.supabase.createClient(config.url, config.publishableKey)
  : null;

const elements = {
  appShell: document.querySelector("#app-shell"),
  authView: document.querySelector("#auth-view"),
  authForm: document.querySelector("#auth-form"),
  authEmail: document.querySelector("#auth-email"),
  authPassword: document.querySelector("#auth-password"),
  authMessage: document.querySelector("#auth-message"),
  signIn: document.querySelector("#sign-in"),
  signUp: document.querySelector("#sign-up"),
  resendConfirmation: document.querySelector("#resend-confirmation"),
  signOut: document.querySelector("#sign-out"),
  userEmail: document.querySelector("#user-email"),
  syncMessage: document.querySelector("#sync-message"),
  syncText: document.querySelector("#sync-text"),
  retryButton: document.querySelector("#retry-button"),
  migrateLocal: document.querySelector("#migrate-local"),
  list: document.querySelector("#product-list"),
  empty: document.querySelector("#empty-state"),
  emptyTitle: document.querySelector("#empty-title"),
  emptyDescription: document.querySelector("#empty-description"),
  emptyAdd: document.querySelector("#empty-add"),
  totalCount: document.querySelector("#total-count"),
  activeCount: document.querySelector("#active-count"),
  lowCount: document.querySelector("#low-count"),
  stockCount: document.querySelector("#stock-count"),
  filteredCount: document.querySelector("#filtered-count"),
  search: document.querySelector("#search"),
  categoryFilter: document.querySelector("#category-filter"),
  statusFilter: document.querySelector("#status-filter"),
  categoryOptions: document.querySelector("#category-options"),
  dialog: document.querySelector("#product-dialog"),
  form: document.querySelector("#product-form"),
  dialogTitle: document.querySelector("#dialog-title"),
  formError: document.querySelector("#form-error"),
  toast: document.querySelector("#toast"),
  importFile: document.querySelector("#import-file"),
};

let products = [];
let editingId = null;
let toastTimer;
let currentUser = null;
let hasLoaded = false;
let mutationInProgress = false;

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("show");
  toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 3300);
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function readLegacyProducts() {
  try {
    const saved = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) throw new Error("儲存資料格式不正確");
    return parsed.map(validateProduct);
  } catch (error) {
    showToast("無法讀取舊版瀏覽器資料。", true);
    return [];
  }
}

function setSyncMessage(message, canRetry = false) {
  elements.syncText.textContent = message;
  elements.syncMessage.hidden = !message;
  elements.retryButton.hidden = !canRetry;
}

function friendlyError(error) {
  if (error?.code === "invalid_credentials" || error?.message === "Invalid login credentials") return "帳號或密碼不正確；第一次使用請按「建立帳號」。";
  if (error?.code === "email_not_confirmed") return "信箱尚未驗證；請先完成驗證信中的步驟。";
  if (error?.code === "email_address_not_authorized") return "Supabase 預設寄信服務只能寄給專案成員；請使用成員信箱，或設定自訂 SMTP。";
  if (error?.code === "over_email_send_rate_limit") return "驗證信寄送太頻繁，請稍後再試。";
  if (error?.code === "email_address_invalid") return "請使用真實的電子郵件地址，測試網域無法註冊。";
  if (error?.code === "23505") return "商品編號已存在，請使用不同編號";
  if (error?.code === "42501") return "沒有存取權限，請重新登入或檢查 Supabase 權限設定";
  if (error?.code === "PGRST205") return "找不到商品資料表，請先執行 supabase/schema.sql";
  return error?.message || "連線失敗，請稍後重試";
}

async function loadProducts() {
  if (!currentUser || !database) return;
  const userId = currentUser.id;
  setSyncMessage("正在從 Supabase 載入商品...");
  try {
    const loaded = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await database.from("products")
        .select("id,name,sku,category,price,stock,status,description,created_at")
        .order("created_at", { ascending: false }).range(start, start + 999);
      if (error) throw error;
      loaded.push(...data);
      if (data.length < 1000) break;
    }
    if (currentUser?.id !== userId) return;
    products = loaded.map(validateProduct);
    hasLoaded = true;
    setSyncMessage("");
    elements.migrateLocal.hidden = readLegacyProducts().length === 0;
    render();
  } catch (error) {
    if (currentUser?.id === userId) {
      hasLoaded = false;
      setSyncMessage(`無法載入商品：${friendlyError(error)}`, true);
      render();
    }
  }
}

async function runMutation(operation, successMessage) {
  if (mutationInProgress) return false;
  mutationInProgress = true;
  try {
    const { error } = await operation();
    if (error) throw error;
    await loadProducts();
    if (!hasLoaded) {
      showToast("變更已儲存，但清單重新載入失敗；請按「重試」。", true);
      return true;
    }
    showToast(successMessage);
    return true;
  } catch (error) {
    showToast(friendlyError(error), true);
    return false;
  } finally {
    mutationInProgress = false;
  }
}

function validateProduct(value) {
  if (!value || typeof value !== "object") throw new Error("商品資料格式不正確");
  const name = String(value.name ?? "").trim();
  const sku = String(value.sku ?? "").trim();
  const category = String(value.category ?? "").trim();
  const description = String(value.description ?? "").trim();
  const price = Number(value.price);
  const stock = Number(value.stock);
  const status = value.status;
  if (!name || name.length > 100) throw new Error("商品名稱必須為 1 至 100 字");
  if (!sku || sku.length > 50) throw new Error("商品編號必須為 1 至 50 字");
  if (!category || category.length > 50) throw new Error("分類必須為 1 至 50 字");
  if (description.length > 2000) throw new Error("商品說明不可超過 2000 字");
  if (!Number.isInteger(price) || price < 0 || price > MAX_NUMBER) throw new Error("價格必須是 0 至 999,999,999 的整數");
  if (!Number.isInteger(stock) || stock < 0 || stock > MAX_NUMBER) throw new Error("庫存必須是 0 至 999,999,999 的整數");
  if (status !== "active" && status !== "inactive") throw new Error("上架狀態不正確");
  return { id: typeof value.id === "string" && value.id ? value.id : newId(), name, sku, category, price, stock, status, description };
}

function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function labeledCell(label, content) {
  const cell = node("div", "product-cell");
  cell.append(node("span", "cell-label", label), content);
  return cell;
}

function toDatabaseProduct(product) {
  const { name, sku, category, price, stock, status, description } = product;
  return { name, sku, category, price, stock, status, description };
}

function updateProduct(id, updates, message) {
  return runMutation(() => database.from("products").update(updates).eq("id", id).select("id").single(), message);
}

function buildProductCard(product) {
  const card = node("article", "product-card");
  const info = node("div", "product-info");
  const avatar = node("div", "product-avatar", product.name.charAt(0).toUpperCase());
  avatar.setAttribute("aria-hidden", "true");
  const identity = node("div", "product-identity");
  identity.style.minWidth = "0";
  const name = node("div", "product-name", product.name);
  name.title = product.name;
  const meta = node("div", "product-meta", `${product.sku}  ·  ${product.category}`);
  identity.append(name, meta);
  if (product.description) {
    const description = node("div", "product-meta", product.description);
    description.title = product.description;
    identity.append(description);
  }
  info.append(avatar, identity);

  const price = labeledCell("售價", node("strong", "product-price", currency.format(product.price)));

  const stepper = node("div", "stock-stepper");
  const minus = node("button", "", "−");
  minus.type = "button";
  minus.setAttribute("aria-label", `減少 ${product.name} 的庫存`);
  minus.disabled = product.stock === 0;
  minus.addEventListener("click", () => updateProduct(product.id, { stock: product.stock - 1 }, "庫存已更新"));
  const stockInput = node("input");
  stockInput.type = "number";
  stockInput.min = "0";
  stockInput.max = String(MAX_NUMBER);
  stockInput.step = "1";
  stockInput.value = String(product.stock);
  stockInput.setAttribute("aria-label", `${product.name} 的庫存數量`);
  stockInput.addEventListener("change", () => {
    const stock = Number(stockInput.value);
    if (stockInput.value.trim() === "" || !Number.isInteger(stock) || stock < 0 || stock > MAX_NUMBER) {
      stockInput.value = String(product.stock);
      showToast("庫存必須是 0 至 999,999,999 的整數", true);
      return;
    }
    if (stock !== product.stock) updateProduct(product.id, { stock }, "庫存已更新");
  });
  const plus = node("button", "", "+");
  plus.type = "button";
  plus.setAttribute("aria-label", `增加 ${product.name} 的庫存`);
  plus.disabled = product.stock >= MAX_NUMBER;
  plus.addEventListener("click", () => updateProduct(product.id, { stock: product.stock + 1 }, "庫存已更新"));
  stepper.append(minus, stockInput, plus);
  const stockContainer = node("div");
  stockContainer.append(stepper);
  if (product.stock <= LOW_STOCK_THRESHOLD) stockContainer.append(node("small", "stock-hint", product.stock === 0 ? "已售完" : "低庫存"));
  const stock = labeledCell("庫存", stockContainer);

  const switchButton = node("button", "status-switch");
  switchButton.type = "button";
  switchButton.setAttribute("aria-pressed", String(product.status === "active"));
  switchButton.setAttribute("aria-label", `${product.name}：${product.status === "active" ? "已上架，點擊下架" : "未上架，點擊上架"}`);
  switchButton.append(node("span", "switch-track"), node("span", "", product.status === "active" ? "已上架" : "未上架"));
  switchButton.addEventListener("click", () => updateProduct(product.id, { status: product.status === "active" ? "inactive" : "active" }, "上架狀態已更新"));
  const status = labeledCell("狀態", switchButton);

  const actions = node("div", "card-actions");
  const edit = node("button", "icon-button", "✎");
  edit.type = "button";
  edit.title = "編輯商品";
  edit.setAttribute("aria-label", `編輯 ${product.name}`);
  edit.addEventListener("click", () => openDialog(product));
  const remove = node("button", "icon-button danger", "×");
  remove.type = "button";
  remove.title = "刪除商品";
  remove.setAttribute("aria-label", `刪除 ${product.name}`);
  remove.addEventListener("click", () => {
    if (confirm(`確定要刪除「${product.name}」嗎？此操作無法復原。`)) {
      runMutation(() => database.from("products").delete().eq("id", product.id).select("id").single(), "商品已刪除");
    }
  });
  actions.append(edit, remove);
  card.append(info, price, stock, status, actions);
  return card;
}

function renderCategories() {
  const selected = elements.categoryFilter.value;
  const categories = [...new Set(products.map((product) => product.category))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  elements.categoryFilter.replaceChildren(new Option("所有分類", ""), ...categories.map((category) => new Option(category, category)));
  elements.categoryFilter.value = categories.includes(selected) ? selected : "";
  elements.categoryOptions.replaceChildren(...categories.map((category) => {
    const option = document.createElement("option");
    option.value = category;
    return option;
  }));
}

function render() {
  elements.totalCount.textContent = String(products.length);
  elements.activeCount.textContent = String(products.filter((product) => product.status === "active").length);
  elements.lowCount.textContent = String(products.filter((product) => product.stock <= LOW_STOCK_THRESHOLD).length);
  elements.stockCount.textContent = new Intl.NumberFormat("zh-TW").format(products.reduce((sum, product) => sum + product.stock, 0));
  renderCategories();
  const query = elements.search.value.trim().toLocaleLowerCase();
  const category = elements.categoryFilter.value;
  const status = elements.statusFilter.value;
  const filtered = products.filter((product) => {
    const matchesQuery = !query || [product.name, product.sku, product.category].some((value) => value.toLocaleLowerCase().includes(query));
    return matchesQuery && (!category || product.category === category) && (!status || product.status === status);
  });
  elements.filteredCount.textContent = String(filtered.length);
  elements.list.replaceChildren(...filtered.map(buildProductCard));
  elements.empty.hidden = filtered.length !== 0 || !hasLoaded;
  if (products.length === 0) {
    elements.emptyTitle.textContent = "還沒有商品";
    elements.emptyDescription.textContent = "新增第一件商品，開始管理你的商品目錄。";
    elements.emptyAdd.hidden = false;
  } else {
    elements.emptyTitle.textContent = "找不到符合條件的商品";
    elements.emptyDescription.textContent = "試試其他關鍵字或篩選條件。";
    elements.emptyAdd.hidden = true;
  }
}

function openDialog(product = null) {
  editingId = product?.id ?? null;
  elements.form.reset();
  elements.formError.hidden = true;
  elements.dialogTitle.textContent = product ? "編輯商品" : "新增商品";
  elements.form.elements.name.value = product?.name ?? "";
  elements.form.elements.sku.value = product?.sku ?? "";
  elements.form.elements.category.value = product?.category ?? "";
  elements.form.elements.price.value = product?.price ?? "";
  elements.form.elements.stock.value = product?.stock ?? "0";
  elements.form.elements.status.value = product?.status ?? "inactive";
  elements.form.elements.description.value = product?.description ?? "";
  elements.dialog.showModal();
  elements.form.elements.name.focus();
}

function closeDialog() {
  elements.dialog.close();
  editingId = null;
}

function showFormError(message) {
  elements.formError.textContent = message;
  elements.formError.hidden = false;
}

async function submitForm(event) {
  event.preventDefault();
  const form = elements.form.elements;
  let product;
  try {
    product = validateProduct({
      id: editingId ?? newId(),
      name: form.name.value,
      sku: form.sku.value,
      category: form.category.value,
      price: form.price.value,
      stock: form.stock.value,
      status: form.status.value,
      description: form.description.value,
    });
    if (form.price.value.trim() === "" || form.stock.value.trim() === "") throw new Error("請填寫價格和庫存數量");
    if (products.some((item) => item.id !== editingId && item.sku.toLocaleLowerCase() === product.sku.toLocaleLowerCase())) {
      throw new Error("商品編號已存在，請使用不同編號");
    }
  } catch (error) {
    showFormError(error.message);
    return;
  }
  const savedId = editingId;
  const payload = toDatabaseProduct(product);
  const saved = await runMutation(
    () => savedId
      ? database.from("products").update(payload).eq("id", savedId).select("id").single()
      : database.from("products").insert(payload).select("id").single(),
    savedId ? "商品已更新" : "商品已新增"
  );
  if (saved) closeDialog();
  else showFormError("儲存失敗，請確認連線後重試。");
}

function exportBackup() {
  const backup = { format: "local-product-manager", version: 1, exportedAt: new Date().toISOString(), products };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `商品備份-${new Date().toLocaleDateString("sv-SE")}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("備份檔已匯出");
}

async function importBackup(file) {
  if (!file) return;
  try {
    if (file.size > 5_000_000) throw new Error("備份檔不可超過 5 MB");
    const data = JSON.parse(await file.text());
    if (data?.format !== "local-product-manager" || data?.version !== 1 || !Array.isArray(data.products)) {
      throw new Error("檔案不是此商品管理頁匯出的 JSON 備份");
    }
    if (data.products.length > 10000) throw new Error("備份商品數不可超過 10,000 件");
    const imported = data.products.map(validateProduct);
    const skus = new Set();
    for (const product of imported) {
      const sku = product.sku.toLocaleLowerCase();
      if (skus.has(sku)) throw new Error(`備份中有重複的商品編號：${product.sku}`);
      skus.add(sku);
    }
    if (!confirm(`將匯入 ${imported.length} 件商品，並取代目前的 ${products.length} 件商品。確定繼續嗎？`)) return;
    await runMutation(
      () => database.rpc("replace_my_products", { items: imported.map(toDatabaseProduct) }),
      "備份已匯入"
    );
  } catch (error) {
    showToast(`匯入失敗：${error.message}`, true);
  } finally {
    elements.importFile.value = "";
  }
}

function showAuthMessage(message, isError = false) {
  elements.authMessage.textContent = message;
  elements.authMessage.hidden = !message;
  elements.authMessage.classList.toggle("error", isError);
}

async function applySession(session) {
  const user = session?.user ?? null;
  if (currentUser?.id === user?.id) return;
  currentUser = user;
  products = [];
  hasLoaded = false;
  if (!user) showAuthMessage("");
  elements.authView.hidden = Boolean(user);
  elements.appShell.hidden = !user;
  elements.userEmail.textContent = user?.email ?? "";
  render();
  if (user) await loadProducts();
}

async function authenticate(mode) {
  if (!database) return;
  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  if (!elements.authEmail.checkValidity() || password.length < 6) {
    showAuthMessage("請輸入有效的電子郵件與至少 6 個字元的密碼。", true);
    return;
  }
  elements.signIn.disabled = true;
  elements.signUp.disabled = true;
  elements.resendConfirmation.disabled = true;
  showAuthMessage(mode === "signUp" ? "正在建立帳號..." : "正在登入...");
  try {
    const { data, error } = mode === "signUp"
      ? await database.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
      : await database.auth.signInWithPassword({ email, password });
    if (error) throw error;
    elements.authPassword.value = "";
    if (data.session) await applySession(data.session);
    else showAuthMessage("請到電子郵件信箱完成帳號驗證，再返回登入。密碼不會儲存在此頁面。");
  } catch (error) {
    showAuthMessage(friendlyError(error), true);
  } finally {
    elements.signIn.disabled = false;
    elements.signUp.disabled = false;
    elements.resendConfirmation.disabled = false;
  }
}

async function resendConfirmation() {
  if (!database) return;
  const email = elements.authEmail.value.trim();
  if (!elements.authEmail.checkValidity()) {
    showAuthMessage("請先輸入要收驗證信的電子郵件地址。", true);
    return;
  }
  elements.signIn.disabled = true;
  elements.signUp.disabled = true;
  elements.resendConfirmation.disabled = true;
  showAuthMessage("正在重寄驗證信...");
  try {
    const { error } = await database.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
    showAuthMessage("若此信箱已有待驗證帳號，請查看收件匣及垃圾郵件匣。請勿連續重寄，以免達到寄送上限。");
  } catch (error) {
    showAuthMessage(friendlyError(error), true);
  } finally {
    elements.signIn.disabled = false;
    elements.signUp.disabled = false;
    elements.resendConfirmation.disabled = false;
  }
}

async function migrateLegacyProducts() {
  const legacy = readLegacyProducts();
  if (!legacy.length) return;
  if (!confirm(`將舊版瀏覽器中的 ${legacy.length} 件商品匯入 Supabase，並取代目前的 ${products.length} 件雲端商品。確定繼續嗎？`)) return;
  const saved = await runMutation(
    () => database.rpc("replace_my_products", { items: legacy.map(toDatabaseProduct) }),
    "舊版商品已匯入 Supabase"
  );
  if (saved) elements.migrateLocal.hidden = true;
}

async function initialize() {
  if (!database) {
    showAuthMessage("Supabase 設定或程式庫載入失敗，請檢查 config.js 與網路連線。", true);
    return;
  }
  database.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => applySession(session), 0);
  });
  const { data, error } = await database.auth.getSession();
  if (error) showAuthMessage(friendlyError(error), true);
  else await applySession(data.session);
}

document.querySelector("#add-product").addEventListener("click", () => openDialog());
elements.authForm.addEventListener("submit", (event) => { event.preventDefault(); authenticate("signIn"); });
elements.signUp.addEventListener("click", () => authenticate("signUp"));
elements.resendConfirmation.addEventListener("click", resendConfirmation);
elements.signOut.addEventListener("click", async () => {
  const { error } = await database.auth.signOut();
  if (error) showToast(friendlyError(error), true);
  else await applySession(null);
});
elements.retryButton.addEventListener("click", loadProducts);
elements.migrateLocal.addEventListener("click", migrateLegacyProducts);
elements.emptyAdd.addEventListener("click", () => openDialog());
document.querySelector("#close-dialog").addEventListener("click", closeDialog);
document.querySelector("#cancel-dialog").addEventListener("click", closeDialog);
elements.dialog.addEventListener("close", () => { editingId = null; });
elements.form.addEventListener("submit", submitForm);
elements.search.addEventListener("input", render);
elements.categoryFilter.addEventListener("change", render);
elements.statusFilter.addEventListener("change", render);
document.querySelector("#export-button").addEventListener("click", exportBackup);
document.querySelector("#refresh-products").addEventListener("click", loadProducts);
document.querySelector("#import-button").addEventListener("click", () => elements.importFile.click());
elements.importFile.addEventListener("change", () => importBackup(elements.importFile.files[0]));

render();
initialize();
