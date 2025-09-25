// app.js — Grid + Detalle (sin carrusel) | carrito backend-authoritativo | Realtime + tools
// Mantiene USD ($) como moneda.

/* =======================
   Estado global
   ======================= */
var data = [];
var cart = [];                // Carrito local (refleja backend)
var selectedQty = 1;          // Qty seleccionada (1–99)
var CLIENT_ID = getOrCreateClientId();
var currentOrderStatus = 0;   // estado sincronizado con backend (0..5)
var lastFormValid = false;    // evita spamear 4 en cada keypress
var lastPrefillSnapshot = ""; // snapshot para detectar cambios del prefill
var selectedName = null;      // Ítem seleccionado para el panel de detalle

function nowIso(){ return new Date().toISOString(); }

/* =======================
   Helpers básicos
   ======================= */
function getOrCreateClientId(){
  try{
    var cid = localStorage.getItem("client_id");
    if(cid && cid.trim().length > 0) return cid;
  }catch(_e){}
  var cid2 = uuidv4();
  try{ localStorage.setItem("client_id", cid2); }catch(_e2){}
  return cid2;
}
function uuidv4(){
  var t = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return t.replace(/[xy]/g, function(c){
    var r = Math.random()*16|0, v = c === "x" ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}
function byId(id){ return document.getElementById(id); }
function normalize(s){ return (s||"").trim().toLowerCase(); }

/* =======================
   Menú: fetch + render
   ======================= */
async function fetchMenu(){
  try{
    var res = await fetch(API_MENU);
    data = await res.json();
    localStorage.setItem("menu_data", JSON.stringify(data));
  }catch(e){
    try{ data = JSON.parse(localStorage.getItem("menu_data")||"[]"); }catch(_e){ data = []; }
  }
  if(!Array.isArray(data)) data = [];
}

function getMenuItemByName(name){
  var key = normalize(name);
  for(var i=0;i<data.length;i++){
    if(normalize(data[i].name)===key) return data[i];
  }
  return null;
}

/* =======================
   GRID (todos los items)
   ======================= */
function renderGrid(){
  var grid = byId("menuGrid");
  if(!grid) return;
  grid.innerHTML = "";

  data.forEach(function(item){
    var card = document.createElement("div");
    card.className = "grid-card";
    if(selectedName && normalize(item.name) === normalize(selectedName)) card.classList.add("selected");

    var img = document.createElement("img");
    img.className = "grid-thumb";
    img.src = item.img_ref || "";
    img.alt = item.name || "";

    var info = document.createElement("div");
    info.className = "grid-info";
    info.innerHTML =
      '<div class="grid-name">'+(item.name||"")+'</div>'+
      '<div class="grid-price">$'+Number(item.price||0).toFixed(2)+'</div>';

    card.appendChild(img);
    card.appendChild(info);
    card.addEventListener("click", function(){ selectItem(item.name, true); });
    grid.appendChild(card);
  });
}

/* =======================
   DETALLE (panel superior)
   ======================= */
function selectItem(name, scrollInto){
  var it = getMenuItemByName(name);
  if(!it) return;
  selectedName = it.name;
  renderDetail(it);

  // Marcar selected en grid
  var cards = document.querySelectorAll(".grid-card");
  for(var i=0;i<cards.length;i++){
    var nm = (cards[i].querySelector(".grid-name")||{}).textContent || "";
    if(normalize(nm) === normalize(selectedName)) cards[i].classList.add("selected");
    else cards[i].classList.remove("selected");
  }

  // Ajustar botón Add según si ya está en el carrito
  if(isSelectedInCart()) setAddedAddBtn(); else setDefaultAddBtn();

  if(scrollInto){
    try{ byId("detailPanel").scrollIntoView({behavior:"smooth", block:"start"}); }catch(_e){}
  }
}

function renderDetail(item){
  var panel = byId("detailPanel");
  if(!panel) return;

  var img = byId("detailImg");
  var nameEl = byId("detailName");
  var priceEl = byId("detailPrice");
  var descEl = byId("detailDesc");
  var ingrEl = byId("detailIngr");

  if(img){ img.src = item.img_ref || ""; img.alt = item.name || ""; }
  if(nameEl) nameEl.textContent = item.name || "";
  if(priceEl) priceEl.textContent = "Precio: $" + Number(item.price||0).toFixed(2);
  if(descEl) descEl.textContent = item.description || "";
  if(ingrEl){
    var ing = (item.ingredients||"").trim();
    ingrEl.textContent = ing ? ing : "";
  }

  panel.setAttribute("aria-hidden","false");
  ensureQtySelector();
}

/* =======================
   Cantidad + Add to cart
   ======================= */
function getSelectedQty(){ return selectedQty; }
function clampQty(q){
  q = parseInt(q, 10);
  if (isNaN(q) || q < 1) return 1;
  if (q > 99) return 99;
  return q;
}
function clampQtyAllowZero(q){
  q = parseInt(q, 10);
  if (isNaN(q) || q < 0) return 0;
  if (q > 99) return 99;
  return q;
}
function updateQtyDisplay(){
  var el = byId("qtyDisplay");
  if (el) el.textContent = String(selectedQty);
  var dec = byId("qtyDec");
  var inc = byId("qtyInc");
  if (dec) dec.disabled = selectedQty <= 1;
  if (inc) inc.disabled = selectedQty >= 99;
}
function ensureQtySelector(){
  var wrap = document.querySelector(".add-to-cart-wrap");
  if(!wrap) return;
  if(byId("qtySelect")) return;
  var qtyWrap = document.createElement("div");
  qtyWrap.className = "qty-select-wrap";
  qtyWrap.id = "qtySelect";
  qtyWrap.innerHTML =
    '<button id="qtyDec" class="qty-arrow" aria-label="Disminuir cantidad" title="Disminuir">v</button>'+
    '<span id="qtyDisplay" class="qty-display">1</span>'+
    '<button id="qtyInc" class="qty-arrow" aria-label="Aumentar cantidad" title="Aumentar">^</button>';
  wrap.prepend(qtyWrap);
  byId("qtyDec").addEventListener("click", function(){ selectedQty = clampQty(selectedQty - 1); updateQtyDisplay(); });
  byId("qtyInc").addEventListener("click", function(){ selectedQty = clampQty(selectedQty + 1); updateQtyDisplay(); });
  updateQtyDisplay();
}
function addToCartBtn(){ return byId("addToCartBtn"); }
function setDefaultAddBtn(){
  var btn = addToCartBtn();
  if(!btn) return;
  if(!selectedName){
    btn.disabled = true; btn.textContent = "Selecciona un producto"; btn.classList.remove("added");
    return;
  }
  btn.disabled = false; btn.textContent = "Agregar al carrito";
  btn.classList.remove("added"); btn.style.background = "";
  selectedQty = 1; updateQtyDisplay();
}
function setAddedAddBtn(){
  var btn = addToCartBtn();
  if(!btn) return;
  btn.disabled = true; btn.textContent = "Agregado al carrito";
  btn.classList.add("added"); btn.style.background = "#22c55e80";
}
function setUpAddToCartBtn(){
  ensureQtySelector();
  var btn = addToCartBtn(); if(!btn) return;
  btn.addEventListener("click", function(){
    if(!selectedName) return;
    var item = getMenuItemByName(selectedName); if(!item) return;
    var qty = getSelectedQty();
    sendCartOps([{ op:"add", name:item.name, qty: qty }]);
    setAddedAddBtn();
  });
  setDefaultAddBtn();
}
function isSelectedInCart(){
  if(!selectedName) return false;
  for(var i=0;i<cart.length;i++){
    if(normalize(cart[i].name)===normalize(selectedName)) return true;
  }
  return false;
}

/* =======================
   Carrito (backend-authoritativo)
   ======================= */
function sanitizeCart(list){
  var out = [];
  for(var i=0;i<(Array.isArray(list)?list:[]).length;i++){
    var it = list[i] || {};
    var qty = parseInt(it.qty,10); if(isNaN(qty)||qty<1) continue;
    out.push({ name: String(it.name||""), price: Number(it.price||0), img_ref: String(it.img_ref||""), qty: qty });
  }
  return out;
}
function replaceCart(newCart){
  cart = sanitizeCart(newCart);
  try{ localStorage.setItem("cart", JSON.stringify(cart)); }catch(_e){}
  updateCartBadge();
  renderCart();

  if(isSelectedInCart()) setAddedAddBtn(); else setDefaultAddBtn();
}
async function syncCartFromBackend(){
  try{
    var res = await fetch("/api/cart/state?client_id="+encodeURIComponent(CLIENT_ID));
    var j = await res.json();
    if(j && j.ok && j.client_id === CLIENT_ID){
      replaceCart(j.cart || []);
      currentOrderStatus = typeof j.order_status === "number" ? j.order_status : currentOrderStatus;
    }
  }catch(_e){}
}
function updateCartBadge(){
  var n = cart.reduce(function(acc, it){ return acc + (Number(it.qty)||0); }, 0);
  var cc = byId("cartCount"); if(cc) cc.textContent = String(n);
}
function openCart(){
  var modal = byId("cartModal"); if(!modal) return;
  modal.setAttribute("data-open","1"); modal.setAttribute("aria-hidden","false");
  renderCart();
}
function closeCart(){
  var modal = byId("cartModal"); if(!modal) return;
  modal.removeAttribute("data-open"); modal.setAttribute("aria-hidden","true");
}
function renderCart(){
  var ul = byId("cartItems");
  var totalEl = byId("cartTotal");
  if(!ul || !totalEl) return;

  var total = cart.reduce(function(acc, it){ return acc + Number(it.price||0) * Number(it.qty||1); }, 0);

  ul.innerHTML = "";
  cart.forEach(function(it, idx){
    var qty = Number(it.qty||1);
    var unit = Number(it.price||0);
    var line = unit * qty;

    var li = document.createElement("li");
    li.className = "cart-item";
    li.innerHTML =
      '<div class="cart-item-img">'+(it.img_ref ? '<img src="'+it.img_ref+'" alt="'+it.name+'">' : "")+'</div>'+
      '<div class="cart-item-info">'+
        '<div class="cart-item-name">'+it.name+'</div>'+
        '<div class="cart-item-meta">Cantidad: <b>'+qty+'</b> · $'+unit.toFixed(2)+' c/u · Subtotal: <b>$'+line.toFixed(2)+'</b></div>'+
        '<div class="qty-controls">'+
          '<button class="btn qty-btn" data-op="dec" data-idx="'+idx+'" title="Quitar uno">-</button>'+
          '<button class="btn qty-btn" data-op="inc" data-idx="'+idx+'" title="Agregar uno">+</button>'+
        '</div>'+
      '</div>'+
      '<div></div>';
    ul.appendChild(li);
  });

  var btns = ul.querySelectorAll(".qty-btn");
  for(var i=0;i<btns.length;i++){
    btns[i].addEventListener("click", function(e){
      var op = e.currentTarget.getAttribute("data-op");
      var i2 = Number(e.currentTarget.getAttribute("data-idx"));
      var item = cart[i2];
      if(!item) return;
      if(op === "inc"){ sendCartOps([{ op:"add", name:item.name, qty:1 }]); }
      else { sendCartOps([{ op:"remove", name:item.name, qty:1 }]); }
    });
  }

  totalEl.textContent = total.toFixed(2);

  var checkoutBtn = byId("checkoutBtn");
  if(checkoutBtn) checkoutBtn.disabled = cart.length === 0;
}

/* =======================
   Modal Carrito — listeners
   ======================= */
function setUpCartModal(){
  var btn = byId("cartBtn");
  var closeBtn = byId("cartClose");
  var backdrop = byId("cartBackdrop");
  var resetBtn = byId("cartReset");
  var checkoutBtn = byId("checkoutBtn");

  if(btn) btn.addEventListener("click", function(){ requestTransition(2); });
  if(closeBtn) closeBtn.addEventListener("click", function(){ localCloseAllModals(); requestTransition(cart.length === 0 ? 0 : 1); });
  if(backdrop) backdrop.addEventListener("click", function(){ localCloseAllModals(); requestTransition(cart.length === 0 ? 0 : 1); });
  if(resetBtn) resetBtn.addEventListener("click", function(){ sendCartOps([{ op:"clear" }]); });
  if(checkoutBtn) checkoutBtn.addEventListener("click", function(){ requestTransition(3); });

  document.addEventListener("keydown", function(e){
    if(e.key==='Escape'){ localCloseAllModals(); requestTransition(cart.length === 0 ? 0 : 1); }
  });
}

/* =======================
   Settings modal — listeners
   ======================= */
function setUpSettingsModal(){
  var openBtn = byId("settingsBtn");
  var modal = byId("settingsModal");
  var closeBtn = byId("modalClose");
  var back = byId("modalBackdrop");
  if(openBtn) openBtn.addEventListener("click", function(){
    if(!modal) return; modal.setAttribute("data-open","1"); modal.setAttribute("aria-hidden","false");
  });
  function close(){
    if(!modal) return; modal.removeAttribute("data-open"); modal.setAttribute("aria-hidden","true");
  }
  if(closeBtn) closeBtn.addEventListener("click", close);
  if(back) back.addEventListener("click", close);
}

/* =======================
   Backend bridge
   ======================= */
async function sendCartOps(ops){
  try{
    await fetch("/api/cart", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ client_id: CLIENT_ID, ops: ops })
    });
    var toShow = extractAddedNames(ops);
    if(toShow.length){ await recommendNames(toShow); }
  }catch(_e){}
}
function extractAddedNames(ops){
  var set = {};
  for(var i=0;i<(Array.isArray(ops)?ops:[]).length;i++){
    var op = ops[i] || {};
    var kind = String(op.op||"").toLowerCase();
    var nm = (op.name||"").trim();
    var qty = parseInt(op.qty,10);
    if(isNaN(qty)) qty = (kind==="add") ? 1 : 0;
    if(kind === "add" && nm && qty > 0) set[nm] = true;
    if(kind === "set" && nm && qty > 0) set[nm] = true;
  }
  var out = []; for(var k in set){ if(set.hasOwnProperty(k)) out.push(k); }
  return out;
}
async function recommendNames(names){
  if(!names || !names.length) return;
  try{
    await fetch("/api/recommend", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ names: names })
    });
  }catch(_e){}
}
async function recommendReset(){
  try{
    await fetch("/api/recommend", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ reset: true })
    });
  }catch(_e){}
}

/* =======================
   WebSocket (Socket.IO)
   ======================= */
var socket = null;
if (typeof window !== "undefined" && typeof window.io === "function") {
  socket = window.io({ transports: ["websocket"], path: "/socket.io" });
} else { socket = { on: function(){}, emit: function(){} }; }

socket.on("connect", function(){
  try { socket.emit("register", { client_id: CLIENT_ID }); } catch(_e){}
});

/* update_front -> ahora selecciona (simula clic) */
socket.on("recommend", function(payload){
  var names = []; if(payload && Array.isArray(payload.names)) names = payload.names;
  if(names.length){
    var chosen = null;
    for(var i=0;i<names.length;i++){
      var nm = names[i] || "";
      if(getMenuItemByName(nm)){ chosen = nm; break; }
    }
    if(chosen){ selectItem(chosen, true); }
  }else{
    selectedName = null;
    var panel = byId("detailPanel"); if(panel){ panel.setAttribute("aria-hidden","true"); }
    renderGrid();
    setDefaultAddBtn();
  }
});

/* Cart desde server — abrir carrito cuando hay ADD/SET>0 */
socket.on("cart_update", function(payload){
  if(payload && payload.client_id && payload.client_id !== CLIENT_ID) return;

  var openBecauseAdd = false;
  var ops = (payload && Array.isArray(payload.ops)) ? payload.ops : [];

  for(var i=0;i<ops.length;i++){
    var op = ops[i] || {};
    var kind = String(op.op||"").toLowerCase();
    var q = parseInt(op.qty,10);
    if(isNaN(q)) q = 0;
    if(kind === "add" && q > 0) openBecauseAdd = true;
    if(kind === "set" && q > 0) openBecauseAdd = true;
  }

  if(payload && Array.isArray(payload.cart)){ replaceCart(payload.cart); }
  else { applyCartOpsFromServer(ops); }

  if(openBecauseAdd){ openCart(); } // mantener abierto si ya estaba
});

/* Orquestación por estado */
socket.on("order_status", function(payload){
  if(!payload || payload.client_id !== CLIENT_ID) return;
  applyOrderStatusUpdate(payload);
});

/* aplicar ops locales si llegan por socket (fallback) */
function applyCartOpsFromServer(ops){
  for(var i=0;i<ops.length;i++){
    var op = ops[i] || {};
    var kind = String(op.op || "").toLowerCase();
    if(kind === "clear"){ cart = []; continue; }
    var name = op && op.name ? op.name : "";
    if(!name && kind !== "clear") continue;

    if(kind === "add"){
      var qAdd = clampQty(op && op.qty ? op.qty : 1);
      var miA = getMenuItemByName(name);
      if(miA){
        var found=false;
        for(var j=0;j<cart.length;j++){
          if(normalize(cart[j].name)===normalize(miA.name)){ cart[j].qty = (cart[j].qty||0)+qAdd; found=true; break; }
        }
        if(!found) cart.push({ name: miA.name, price: Number(miA.price||0), img_ref: miA.img_ref||"", qty: qAdd });
      }
    } else if(kind === "remove"){
      var qRem = clampQty(op && op.qty ? op.qty : 1);
      for(var k=0;k<cart.length;k++){
        if(normalize(cart[k].name)===normalize(name)){
          var cur = Number(cart[k].qty||1);
          if(cur <= qRem){ cart.splice(k,1); } else { cart[k].qty = cur - qRem; }
          break;
        }
      }
    } else if(kind === "set"){
      var qSet = clampQtyAllowZero(op && op.qty != null ? op.qty : 1);
      var idx = -1;
      for(var kk=0;kk<cart.length;kk++){ if(normalize(cart[kk].name)===normalize(name)){ idx=kk; break; } }
      if(qSet <= 0){ if(idx>=0) cart.splice(idx,1); }
      else{
        var mi = getMenuItemByName(name);
        if(mi){
          if(idx>=0){ cart[idx].qty = qSet; }
          else{ cart.push({ name: mi.name, price: Number(mi.price||0), img_ref: mi.img_ref||"", qty: qSet }); }
        }
      }
    }
  }
  try{ localStorage.setItem("cart", JSON.stringify(cart)); }catch(_e){}
  updateCartBadge();
  renderCart();
  if(isSelectedInCart()) setAddedAddBtn(); else setDefaultAddBtn();
}

/* =======================
   Realtime + tools
   ======================= */
var pc = null;
var dataChannel = null;
var remoteAudio = null;

function dcSend(obj){
  if(!dataChannel || dataChannel.readyState!=="open") return;
  try { dataChannel.send(JSON.stringify(obj)); } catch(_e){}
}
function extractArgs(raw){
  if(raw == null) return {};
  if(typeof raw === "string"){ try { return JSON.parse(raw || "{}"); } catch(_e){ return {}; } }
  return raw || {};
}
function getToolMeta(evt){
  var name = (evt && (evt.name || (evt["function"] && evt["function"].name) || (evt.tool && evt.tool.name))) || "";
  var callId = (evt && (evt.call_id || evt.id || evt.tool_call_id)) || "";
  var argsRaw = evt && (evt.arguments_json!=null ? evt.arguments_json
                   : evt.arguments!=null ? evt.arguments
                   : (evt["function"] && evt["function"].arguments) ? evt["function"].arguments
                   : (evt.tool && evt.tool.arguments) ? evt.tool.arguments
                   : "{}");
  return { name: name, callId: callId, args: extractArgs(argsRaw) };
}
function sendFunctionResult(callId, outputObj, replyInstructions){
  dcSend({
    type: "conversation.item.create",
    item: { type: "function_call_output", call_id: callId, output: JSON.stringify(outputObj || {}) }
  });
  var resp = { type: "response.create", response: {} };
  if (replyInstructions && replyInstructions.trim().length > 0){
    resp.response.instructions = replyInstructions.trim();
  }
  dcSend(resp);
}
function startGreetingTurn(){
  dcSend({
    type: "response.create",
    response: {
      instructions: [
        "Comienza con un saludo breve como asistente de VUEN AI.",
        "Pregunta: '¿Qué te gustaría comer hoy?'",
      ].join("\n")
    }
  });
}

async function handleToolCall(evt){
  var meta = getToolMeta(evt);
  var name = meta.name, callId = meta.callId;
  if(!callId){ console.warn("[toolcall:missing_call_id]", { name: name, evt: evt && evt.type }); return; }

  if(name === "update_front"){
    var parsed = meta.args || {};
    var names = Array.isArray(parsed.names) ? parsed.names : [];
    var reply = (typeof parsed.reply==="string" && parsed.reply.trim().length>0) ? parsed.reply.trim() : "";
    try{
      await fetch("/api/recommend", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ names: names }) });
    }catch(_e){}
    sendFunctionResult(callId, { ok:true, names:names }, reply || "");
    return;
  }

  if (name === "update_cart"){
    var parsed2 = meta.args || {};
    var action = String(parsed2.action || "apply").toLowerCase();
    var ops = Array.isArray(parsed2.ops) ? parsed2.ops : [];
    var reply2 = (typeof parsed2.reply==="string" && parsed2.reply.trim().length>0) ? parsed2.reply.trim() : "";

    if(action === "clear"){
      try{ await fetch("/api/cart", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ client_id: CLIENT_ID, ops: [{ op:"clear" }] }) }); }catch(_e4){}
      await recommendReset();
      sendFunctionResult(callId, { ok:true, action:"clear" }, reply2 || "Listo, vacié tu carrito.");
      return;
    }

    try{ await fetch("/api/cart", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ client_id: CLIENT_ID, ops: ops }) }); }catch(_e5){}
    var toShow = extractAddedNames(ops);
    if(toShow.length){ await recommendNames(toShow); }
    sendFunctionResult(callId, { ok:true, action:"apply", applied: ops.length }, reply2 || "Listo, actualicé tu carrito.");
    return;
  }

  if (name === "get_cart" || name === ""){
    try {
      var cid3 = CLIENT_ID;
      var res3 = await fetch("/api/cart/state?client_id=" + encodeURIComponent(cid3));
      var j3 = await res3.json();

      if (j3 && j3.ok && j3.client_id === CLIENT_ID) {
        replaceCart(j3.cart || []);
        var total3 = (typeof j3.total === "number") ? j3.total :
                     cart.reduce(function(acc, it){ return acc + Number(it.price||0)*Number(it.qty||1); }, 0);
        var shortDefault = (!cart.length) ? "Tu carrito está vacío por ahora."
                           : (function(){ var c = cart.reduce(function(a, it){ return a + (Number(it.qty)||0); }, 0);
                                          return "Tienes " + c + " artículo" + (c>1?"s":"") + ", total $" + total3.toFixed(2) + "."; })();

        sendFunctionResult(callId, { ok:true, client_id: cid3, cart: j3.cart || [], total: total3 }, shortDefault);
      } else {
        sendFunctionResult(callId, { ok:false, error:"No se pudo obtener el carrito." }, "No pude obtener tu carrito ahora mismo.");
      }
    } catch(_e6){
      sendFunctionResult(callId, { ok:false, error:"Fallo de red consultando el carrito." }, "Hubo un problema al consultar tu carrito.");
    }
    return;
  }

  if (name === "get_order_status") {
    var args = meta.args || {};
    var replyG = (typeof args.reply==="string" && args.reply.trim().length>0) ? args.reply.trim() : "";
    try{
      var resG = await fetch("/api/order_status?client_id=" + encodeURIComponent(CLIENT_ID));
      var jG = await resG.json();
      var st = (jG && jG.ok) ? jG.status : null;
      if (typeof st === "number") {
        currentOrderStatus = st;
        var m = {0:"Tu carrito está vacío.",1:"Tienes artículos en el carrito.",2:"Tienes el carrito abierto.",3:"Estamos en checkout. Necesito los datos del formulario",4:"Datos completos, puedes finalizar.",5:"Mostrando confirmación de pedido."};
        sendFunctionResult(callId, { ok:true, status: st }, replyG || (m[st] || ("Estado actual: " + st)));
      } else {
        sendFunctionResult(callId, { ok:false, error:"No status" }, replyG || "No pude obtener el estado ahora mismo.");
      }
    }catch(e){
      sendFunctionResult(callId, { ok:false, error:String(e && e.message || e) }, replyG || "Hubo un problema consultando el estado.");
    }
    return;
  }

  if (name === "transition_order_status") {
    var argsT = meta.args || {};
    var to = typeof argsT.to === "number" ? argsT.to : null;
    var prefill = (argsT.prefill && typeof argsT.prefill === "object") ? argsT.prefill : null;
    var replyT = (typeof argsT.reply==="string" && argsT.reply.trim().length>0) ? argsT.reply.trim() : "";

    if (to == null) { sendFunctionResult(callId, { ok:false, error:"Missing 'to' status" }, "Necesito saber a qué paso quieres ir."); return; }
    try {
      if (to === 5) { try { await sendCartOps([{ op:"clear" }]); } catch(_e){} }
      var body = { client_id: CLIENT_ID, from: currentOrderStatus, to: to };
      if (prefill) body.prefill = prefill;

      var resT = await fetch("/api/order_status/transition", {
        method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body)
      });
      var jT = await resT.json();
      sendFunctionResult(callId, jT, replyT || "");
    } catch (e) {
      sendFunctionResult(callId, { ok:false, error:String(e && e.message || e) }, "Tuvimos un problema al cambiar de paso, ¿puedes repetir?");
    }
    return;
  }

  sendFunctionResult(callId, { ok:false, error: "Tool '"+(name||"unknown")+"' not implemented" }, "");
}

/* =======================
   Order Status: helpers
   ======================= */
function localCloseAllModals(){
  var ids = ["settingsModal","cartModal","checkoutModal","successModal"];
  for(var i=0;i<ids.length;i++){
    var m = byId(ids[i]);
    if(m){ m.removeAttribute("data-open"); m.setAttribute("aria-hidden","true"); }
  }
}

function setModalOpen(el, open){
  if(!el) return;
  if(open){ el.setAttribute("data-open","1"); el.setAttribute("aria-hidden","false"); }
  else { el.removeAttribute("data-open"); el.setAttribute("aria-hidden","true"); }
}
function openCheckout(preserve){
  var ul = byId("checkoutSummary");
  var totalEl = byId("checkoutTotal");
  if(ul){ ul.innerHTML = ""; }
  var total = 0;
  for(var i=0;i<cart.length;i++){
    var it = cart[i], qty = Number(it.qty||1), price = Number(it.price||0), line = qty*price;
    total += line;
    if(ul){
      var li = document.createElement("li");
      li.className = "cart-item";
      li.innerHTML =
        '<div class="cart-item-img">'+(it.img_ref ? '<img src="'+it.img_ref+'" alt="'+it.name+'">' : "")+'</div>'+
        '<div class="cart-item-info">'+
          '<div class="cart-item-name">'+it.name+'</div>'+
          '<div class="cart-item-meta">Cantidad: <b>'+qty+'</b> · $'+price.toFixed(2)+' c/u · Subtotal: <b>$'+line.toFixed(2)+'</b></div>'+
        '</div>'+
        '<div></div>';
      ul.appendChild(li);
    }
  }
  if(totalEl){ totalEl.textContent = total.toFixed(2); }

  if(!preserve){
    var form = byId("checkoutForm"); if(form){ form.reset(); }
    var payBtn = byId("payConfirmBtn"); if(payBtn){ payBtn.disabled = true; }
    lastFormValid = false; lastPrefillSnapshot = "";
  }

  var modal = byId("checkoutModal");
  if(modal){ modal.setAttribute("data-open","1"); modal.setAttribute("aria-hidden","false"); }
}
function closeCheckout(){
  var modal = byId("checkoutModal");
  if(modal){ modal.removeAttribute("data-open"); modal.setAttribute("aria-hidden","true"); }
}
function digitsOnly(s){ return (s||"").replace(/\D+/g,""); }
function validateCheckoutForm(){
  var nameEl = byId("cName");
  var phoneEl = byId("cPhone");
  var emailEl = byId("cEmail");
  var cardEl  = byId("cCard");
  var expEl   = byId("cExp");
  var cvvEl   = byId("cCVV");

  var prefill = {
    name:  (nameEl && nameEl.value || "").trim(),
    phone: digitsOnly(phoneEl && phoneEl.value || ""),
    email: (emailEl && emailEl.value || "").trim(),
    card:  digitsOnly(cardEl && cardEl.value || ""),
    exp:   (expEl && expEl.value || "").trim(),
    cvv:   digitsOnly(cvvEl && cvvEl.value || "")
  };

  // Validaciones locales (idénticas)
  var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prefill.email);
  var phoneOk = prefill.phone.length >= 7;
  var cardOk  = prefill.card.length >= 13 && prefill.card.length <= 19;
  var expOk   = /^(\d{2})\/(\d{2})$/.test(prefill.exp);
  if(expOk){ var mm = parseInt(prefill.exp.slice(0,2),10); expOk = mm>=1 && mm<=12; }
  var cvvOk   = (prefill.cvv.length===3 || prefill.cvv.length===4);
  var allOk   = !!prefill.name && phoneOk && emailOk && cardOk && expOk && cvvOk;

  var btn = byId("payConfirmBtn");
  if(btn){ btn.disabled = !allOk; }

  // Anti-spam: solo enviar cuando cambió el snapshot
  var snap = "";
  try { snap = JSON.stringify(prefill); } catch(_e){}
  if (snap !== lastPrefillSnapshot) {
    // Si está completo → promovemos a 4; si no, actualizamos parcial en 3
    requestTransition(allOk ? 4 : 3, prefill);
    lastPrefillSnapshot = snap;
  }

  lastFormValid = allOk;
}
function setUpCheckoutModal(){
  var backdrop = byId("checkoutBackdrop");
  var closeBtn = byId("checkoutClose");
  var inputs = ["cName","cPhone","cEmail","cCard","cExp","cCVV"].map(function(id){ return byId(id); });
  var payBtn = byId("payConfirmBtn");

  if(backdrop) backdrop.addEventListener("click", function(){ localCloseAllModals(); requestTransition(cart.length===0?0:1); });
  if(closeBtn) closeBtn.addEventListener("click", function(){ localCloseAllModals(); requestTransition(cart.length===0?0:1); });
  for(var i=0;i<inputs.length;i++){
    var el = inputs[i];
    if(el){ el.addEventListener("input", validateCheckoutForm); el.addEventListener("blur", validateCheckoutForm); }
  }
  if(payBtn) payBtn.addEventListener("click", finalizePurchase);

  var okBtn = byId("successOkBtn");
  var successBackdrop = byId("successBackdrop");
  if(okBtn){ okBtn.addEventListener("click", function(){ var s = byId("successModal"); if(s){ s.removeAttribute("data-open"); s.setAttribute("aria-hidden","true"); } requestTransition(0); }); }
  if(successBackdrop){ successBackdrop.addEventListener("click", function(){ var s = byId("successModal"); if(s){ s.removeAttribute("data-open"); s.setAttribute("aria-hidden","true"); } requestTransition(0); }); }
}
async function finalizePurchase(){
  try{ await recommendReset(); }catch(_e){}
  try{ await sendCartOps([{ op:"clear" }]); }catch(_e){}
  requestTransition(5);
}
function prefillCheckoutForm(p){
  if(!p) return;
  if(p.name != null && byId("cName"))  byId("cName").value  = p.name;
  if(p.phone != null && byId("cPhone")) byId("cPhone").value = p.phone;
  if(p.email != null && byId("cEmail")) byId("cEmail").value = p.email;
  if(p.card != null && byId("cCard"))  byId("cCard").value  = p.card;
  if(p.exp != null && byId("cExp"))    byId("cExp").value   = p.exp;
  if(p.cvv != null && byId("cCVV"))    byId("cCVV").value   = p.cvv;
  validateCheckoutForm();
  try { lastPrefillSnapshot = JSON.stringify({
    name: byId("cName") ? byId("cName").value : "",
    phone: byId("cPhone") ? byId("cPhone").value : "",
    email: byId("cEmail") ? byId("cEmail").value : "",
    card: byId("cCard") ? byId("cCard").value : "",
    exp: byId("cExp") ? byId("cExp").value : "",
    cvv: byId("cCVV") ? byId("cCVV").value : ""
  }); } catch(_e){}
}
function applyOrderStatusUpdate(payload){
  var prev = currentOrderStatus;
  currentOrderStatus = payload.status;

  // Estado 1 = "carrito con items".
  // No cerramos nada: respetamos lo que el usuario (o el add automático) haya abierto.
  if(payload.status === 1){
    return;
  }

  // Estado 0 = "carrito vacío": cerrar todo.
  if(payload.status === 0){
    localCloseAllModals();
    return;
  }

  // Estado 2 = "carrito abierto": cerramos checkout/success y abrimos carrito.
  if(payload.status === 2){
    setModalOpen(document.getElementById("checkoutModal"), false);
    setModalOpen(document.getElementById("successModal"), false);
    openCart();
    return;
  }

  // Estado 3 = "checkout abierto (relleno incompleto/pendiente)": cerramos carrito/success y abrimos checkout (fresh).
  if(payload.status === 3){
    setModalOpen(document.getElementById("cartModal"), false);
    setModalOpen(document.getElementById("successModal"), false);
    openCheckout(false);
    if(payload.prefill){ prefillCheckoutForm(payload.prefill); }
    return;
  }

  // Estado 4 = "checkout válido (listo para finalizar)": cerramos carrito/success y abrimos checkout preservando entradas.
  if(payload.status === 4){
    setModalOpen(document.getElementById("cartModal"), false);
    setModalOpen(document.getElementById("successModal"), false);
    openCheckout(true);
    if(payload.prefill){ prefillCheckoutForm(payload.prefill); }
    var btn = document.getElementById("payConfirmBtn");
    if(btn) btn.disabled = false;
    return;
  }

  // Estado 5 = "confirmación de pedido": cerramos carrito/checkout y abrimos success.
  if(payload.status === 5){
    setModalOpen(document.getElementById("cartModal"), false);
    setModalOpen(document.getElementById("checkoutModal"), false);
    setModalOpen(document.getElementById("successModal"), true);
    return;
  }
}

async function requestTransition(to, prefill){
  try{
    var body = { client_id: CLIENT_ID, from: currentOrderStatus, to: to };
    if(prefill){ body.prefill = prefill; }
    var res = await fetch("/api/order_status/transition", {
      method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(body)
    });
    var j = await res.json();
    if(j && j.ok && typeof j.status === "number" && !(socket && socket.connected)){
      var extra = {}; if (j.prefill) extra.prefill = j.prefill;
      applyOrderStatusUpdate({ client_id: CLIENT_ID, status: j.status, prefill: extra.prefill });
    }
  }catch(e){ console.error("[order_status:transition:error]", e); }
}

/* =======================
   Mic / Reset UI
   ======================= */
(function setupMic(){
  var micBtn = byId("micBtn"); if(!micBtn) return;
  micBtn.addEventListener("click", async function(){
    micBtn.classList.toggle("active");
    if(!pc){
      await startRealtime();
    }else{
      try { await recommendReset(); } catch(_e){}
      selectedName = null; var p = byId("detailPanel"); if(p){ p.setAttribute("aria-hidden","true"); }
      renderGrid(); setDefaultAddBtn();

      if (pc) {
        pc.getSenders().forEach(function(s){ try{ s.track && s.track.stop(); }catch(_e4){} });
        pc.close(); pc = null;
      }
      micBtn.classList.remove("active");
    }
  });
})();

/* =======================
   Realtime boot
   ======================= */
async function startRealtime(){
  await syncCartFromBackend();

  var url = "/api/realtime/session?client_id=" + encodeURIComponent(CLIENT_ID);
  var res = await fetch(url, {
    method:"POST",
    headers:{ "Content-Type":"application/json", "X-Client-Id": CLIENT_ID },
    body: JSON.stringify({ client_id: CLIENT_ID })
  });
  var sess = await res.json();
  if(sess.error){ alert("Realtime error: "+sess.error); return; }

  var EPHEMERAL_KEY = (sess.client_secret && sess.client_secret.value) || sess.value || null;
  if(!EPHEMERAL_KEY){ alert("No ephemeral key received"); return; }

  var pcLocal = new RTCPeerConnection(); pc = pcLocal;
  if(!remoteAudio){ remoteAudio = new Audio(); remoteAudio.autoplay = true; }
  pc.ontrack = function(e){ remoteAudio.srcObject = e.streams[0]; };

  var ms = await navigator.mediaDevices.getUserMedia({audio:true});
  ms.getTracks().forEach(function(t){ pc.addTrack(t, ms); });

  dataChannel = pc.createDataChannel("oai-events");
  dataChannel.onopen = function(){ startGreetingTurn(); };
  dataChannel.onmessage = function(e){ handleIncomingEvent(e.data); };

  var offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  var resp = await fetch("https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview", {
    method:"POST",
    body: offer.sdp,
    headers:{ Authorization: "Bearer " + EPHEMERAL_KEY, "Content-Type": "application/sdp" }
  });
  var answerSDP = await resp.text();
  await pc.setRemoteDescription({type:"answer", sdp: answerSDP});
}
function handleIncomingEvent(raw){
  var evt = null; try { evt = JSON.parse(raw); } catch(_e){ return; }
  var t = evt && evt.type; if(!t) return;
  if (t === "response.function_call_arguments.done" || t === "response.tool_call"){ handleToolCall(evt); }
}

/* =======================
   Boot
   ======================= */
(async function boot(){
  await fetchMenu();
  await syncCartFromBackend();

  renderGrid();                 // Muestra todos los productos
  setUpAddToCartBtn();          // Activa botón/agregador
  setUpCartModal();             // Listeners del carrito
  setUpSettingsModal();         // Settings ⚙️
  setUpCheckoutModal();         // Checkout listeners
  updateCartBadge();
})();
