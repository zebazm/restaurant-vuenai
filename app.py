# app.py — Flask + Flask-SocketIO + Realtime

import eventlet
eventlet.monkey_patch()

from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, join_room
from pathlib import Path
from datetime import datetime
import json, os, requests, re, logging
from dotenv import load_dotenv


# Cargar variables desde el archivo .env
load_dotenv()


app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

MENU_PATH = Path("static/menu.json")

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("server")

# ======================
# Helpers
# ======================

def load_menu():
    if MENU_PATH.exists():
        try:
            return json.loads(MENU_PATH.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []

def normalize_menu(items):
    cleaned = []
    for item in (items or []):
        cleaned.append({
            "name": str(item.get("name","")).strip(),
            "price": float(item.get("price", 0) or 0),
            "img_ref": str(item.get("img_ref","")).strip(),
            "ingredients": str(item.get("ingredients","")).strip(),
            "description": str(item.get("description","")).strip(),
        })
    return cleaned

def build_menu_prompt(menu_items):
    lines = []
    for it in menu_items:
        name = it.get("name","").strip()
        price = it.get("price", 0)
        desc = (it.get("description") or "").strip()
        ingr = (it.get("ingredients") or "").strip()
        base = f"- {name} — ${price:0.2f}"
        if desc:
            base += f": {desc}"
        if ingr:
            base += f" (ingredientes: {ingr})"
        lines.append(base)
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    header = [
        "You are a realtime voice agent for a restaurant called VUEN AI.",
        f"Use ONLY the following official menu",
        "Recommend at most 1–3 items: name + price + a short reason.",
        "If unsure, ask. Keep answers short and conversational.",
        "Respond in the user's language; default to Spanish.",
        "Do NOT invent items that are not in the menu.",
        "",
        "TOOLS:",
        "- Use `update_front` when you want to highlight/show only certain menu items on the client UI.",
        "- Use `update_cart` to apply changes to the cart with `ops`, or clear it with `action: clear`. Do NOT include `client_id`; the client routes it correctly.",
        "- Use `get_cart` when asked for cart status, item count, or total price. Do NOT include `client_id`; the client routes it.",
        "- Use `get_order_status` to retrieve the current order flow step (0..5).",
        "- Use `transition_order_status` to change UI flow (cart/checkout/success).",
        "",
        "IMPORTANT!! Before you call `transition_order_status`, ALWAYS call `get_order_status` to ensure the state is fresh.",
        "When you use these tools, include a short `reply` so the user hears an immediate response.",
        "If you are asked for the state of the cart or the current total price, ALWAYS use get_cart, even if you know the answer. Never assume totals from memory.",
        "",
        "INSTRUCTIONS:",
        "Guide the customer through the purchasing process on the ordering platform.",
        "The first step will be to ask what you want to eat, and advise you to add the items you want to the cart. Everytime you recommend or talk about a product, use `update_front` to show the product details",
        "If the customer is satisfied with their order, you will continue with the order, going through each order status using `transition_order_status` following the next steps:",
        "1. The customer has items in the shopping cart",
        "2. The shopping cart is opened, here you have to ask if there is anything else to be added or continue to checkout. do a recap and summary",
        "3. The customer acepted to continue with the payment, so the modal with the customer information and payment method is showed. Here YOU WILL ASK for the name, phone, email and credit card information to help the customer fill this form. (ALWAYS the payment will be with card. never ask other payment options. if the customer ask for other payment options explain that you can only acept credit card)",
        "4. The customer completed the necessary information, ask to check if everything is correct",
        "5. The customer successfully placed the order. Explain that the order will arive soon, and ask to check the email and contact phone to tack the order"
    ]
    menu_block = "\n".join(lines) if lines else "- (menú vacío)"
    return "\n".join(header) + "\n\nMenu:\n" + menu_block

def normalize(s): return str(s or "").strip().lower()

def clamp_qty_allow_zero(q):
    try:
        q = int(q)
    except Exception:
        q = 0
    if q < 0: q = 0
    if q > 99: q = 99
    return q

def get_menu_item_by_name(name):
    key = normalize(name)
    for it in MENU_CACHE:
        if normalize(it.get("name")) == key:
            return it
    return None

def apply_ops_to_cart(cart_items, ops):
    if cart_items is None:
        cart_items = []
    items = list(cart_items)

    def find_idx(nm):
        k = normalize(nm)
        for i, it in enumerate(items):
            if normalize(it.get("name")) == k:
                return i
        return -1

    for op in (ops or []):
        kind = normalize(op.get("op"))
        if kind == "clear":
            items = []
            continue

        name = (op.get("name") or "").strip()
        if not name:
            continue

        qty = clamp_qty_allow_zero(op.get("qty", 1))
        idx = find_idx(name)

        if kind == "add":
            if qty <= 0: qty = 1
            mi = get_menu_item_by_name(name)
            if not mi:
                continue
            if idx >= 0:
                items[idx]["qty"] = int(items[idx].get("qty", 0)) + qty
            else:
                items.append({
                    "name": mi["name"],
                    "price": float(mi.get("price") or 0),
                    "img_ref": mi.get("img_ref") or "",
                    "qty": qty
                })

        elif kind == "remove":
            if qty <= 0: qty = 1
            if idx < 0:
                continue
            cur = int(items[idx].get("qty", 1))
            if cur <= qty:
                items.pop(idx)
            else:
                items[idx]["qty"] = cur - qty

        elif kind == "set":
            if qty <= 0:
                if idx >= 0:
                    items.pop(idx)
                continue
            mi = get_menu_item_by_name(name)
            if not mi:
                continue
            if idx >= 0:
                items[idx]["qty"] = qty
                items[idx]["price"] = float(mi.get("price") or 0)
                items[idx]["img_ref"] = mi.get("img_ref") or ""
            else:
                items.append({
                    "name": mi["name"],
                    "price": float(mi.get("price") or 0),
                    "img_ref": mi.get("img_ref") or "",
                    "qty": qty
                })

    return items

def cart_total(items):
    t = 0.0
    for it in (items or []):
        try:
            t += float(it.get("price") or 0) * float(it.get("qty") or 1)
        except Exception:
            pass
    return round(t, 2)

# ======================
# Global caches
# ======================

MENU_CACHE = normalize_menu(load_menu())
INSTRUCTIONS_CACHE = build_menu_prompt(MENU_CACHE)

# Estado
CARTS = {}             # client_id -> [{name, price, img_ref, qty}]
ORDER_STATUS = {}      # client_id -> int (0..5)
CHECKOUT_PREFILL = {}  # client_id -> dict {raw, cleaned, valid}

def get_cart_for(client_id):
    return CARTS.get(client_id, [])

def compute_base_status_for_client(client_id):
    return 0 if len(get_cart_for(client_id)) == 0 else 1

def set_order_status(client_id, new_status, announce=True, extra=None):
    prev = ORDER_STATUS.get(client_id, compute_base_status_for_client(client_id))
    ORDER_STATUS[client_id] = int(new_status)
    changed = (prev != new_status)
    payload = {"client_id": client_id, "status": int(new_status)}
    if isinstance(extra, dict):
        payload.update(extra)
    if announce and changed:
        socketio.emit("order_status", payload, to=client_id)
        log.info("[order-status] %s -> %s (%s)", prev, new_status, client_id)
    return {"prev": prev, "next": int(new_status), "changed": changed}

def validate_prefill(data):
    data = data or {}
    name = str(data.get("name","")).strip()
    phone = re.sub(r"\D+", "", str(data.get("phone","")))
    email = str(data.get("email","")).strip()
    card = re.sub(r"\D+", "", str(data.get("card","")))
    exp  = str(data.get("exp","")).strip()
    cvv  = re.sub(r"\D+", "", str(data.get("cvv","")))

    missing = []

    if not name: missing.append("name")
    if len(phone) < 7: missing.append("phone")
    if not re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email or ""): missing.append("email")
    if not (13 <= len(card) <= 19): missing.append("card")
    if not re.match(r"^\d{2}/\d{2}$", exp or ""):
        missing.append("exp")
    else:
        try:
            mm = int(exp[:2])
            if not (1 <= mm <= 12):
                missing.append("exp")
        except Exception:
            missing.append("exp")
    if not (len(cvv) in (3,4)): missing.append("cvv")

    ok = (len(missing) == 0)
    cleaned = {
        "name": name, "phone": phone, "email": email,
        "card_last4": card[-4:] if card else "",
        "exp": exp, "cvv_len": len(cvv)
    }
    return ok, missing, cleaned

# ---- NUEVO: fusión parcial de prefill por cliente ----
_ALLOWED_PREFILL_KEYS = {"name","phone","email","card","exp","cvv"}

def merge_prefill_patch(client_id, patch):
    st = CHECKOUT_PREFILL.get(client_id) or {"raw": {}, "cleaned": {}, "valid": False}
    raw = dict(st.get("raw") or {})
    patch = patch or {}
    for k, v in patch.items():
        if k in _ALLOWED_PREFILL_KEYS and v is not None:
            raw[k] = str(v)
    ok, missing, cleaned = validate_prefill(raw)
    CHECKOUT_PREFILL[client_id] = {"raw": raw, "cleaned": cleaned, "valid": ok}
    return ok, missing, raw

# ======================
# Socket.IO
# ======================

@socketio.on("register")
def on_register(data):
    client_id = (data or {}).get("client_id", "").strip()
    if client_id:
        join_room(client_id)
        if client_id not in ORDER_STATUS:
            ORDER_STATUS[client_id] = compute_base_status_for_client(client_id)
        log.info("[socket-register] client_id=%s status=%s", client_id, ORDER_STATUS[client_id])

# ======================
# Rutas
# ======================

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/settings")
def settings():
    return render_template("settings.html")

@app.route("/api/menu", methods=["GET","POST"])
def api_menu():
    global MENU_CACHE, INSTRUCTIONS_CACHE
    if request.method == "GET":
        return app.send_static_file("menu.json")
    else:
        payload = request.get_json(force=True, silent=True) or []
        MENU_CACHE = normalize_menu(payload)
        MENU_PATH.write_text(json.dumps(MENU_CACHE, indent=2), encoding="utf-8")
        INSTRUCTIONS_CACHE = build_menu_prompt(MENU_CACHE)
        return jsonify({"ok": True, "count": len(MENU_CACHE)})

@app.post("/api/recommend")
def api_recommend():
    data = request.get_json(force=True, silent=True) or {}
    if data.get("reset"):
        socketio.emit("reset", {"ok": True})
        return jsonify({"ok": True, "reset": True})
    names = [str(n or "").strip() for n in (data.get("names") or []) if str(n or "").strip()]
    socketio.emit("recommend", {"names": names})
    return jsonify({"ok": True, "names": names})

@app.get("/api/cart/state")
def api_cart_state():
    client_id = (request.args.get("client_id") or "").strip()
    cart = CARTS.get(client_id, [])
    total = cart_total(cart)
    status = ORDER_STATUS.get(client_id, compute_base_status_for_client(client_id))
    return jsonify({"ok": True, "cart": cart, "client_id": client_id, "total": total, "order_status": status})

@app.post("/api/cart")
def api_cart():
    data = request.get_json(force=True, silent=True) or {}
    client_id = (data.get("client_id") or "").strip()
    ops = data.get("ops") or []

    cur = CARTS.get(client_id, [])
    new_cart = apply_ops_to_cart(cur, ops)
    CARTS[client_id] = new_cart

    payload = {"client_id": client_id, "ops": ops, "cart": new_cart}
    if client_id:
        socketio.emit("cart_update", payload, to=client_id)
    else:
        socketio.emit("cart_update", payload)

    cur_status = ORDER_STATUS.get(client_id, compute_base_status_for_client(client_id))
    if cur_status in (0, 1, 2):
        if len(new_cart) == 0:
            set_order_status(client_id, 0, announce=True)
        else:
            new_status = 2 if cur_status == 2 else 1
            set_order_status(client_id, new_status, announce=True)

    return jsonify({"ok": True, "applied": len(ops), "cart": new_cart, "client_id": client_id})

@app.route("/api/realtime/session", methods=["POST"])
def realtime_session():
    OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
    if not OPENAI_API_KEY:
        raise RuntimeError("Falta la variable OPENAI_API_KEY")
    body = request.get_json(silent=True) or {}
    model = body.get("model", "gpt-4o-realtime-preview")
    voice = body.get("voice", "verse")

    client_id = request.headers.get("X-Client-Id") or request.args.get("client_id") or body.get("client_id") or ""
    client_id = str(client_id).strip()

    instrucciones = INSTRUCTIONS_CACHE

    if client_id:
        cart = CARTS.get(client_id, [])
        if cart:
            lines = []
            total = 0.0
            for it in cart:
                nm = it.get("name","")
                q = int(it.get("qty") or 0)
                p = float(it.get("price") or 0.0)
                total += q*p
                lines.append(f"- {nm} x{q} — ${p:0.2f} c/u")
            cart_block = "\n".join(lines) + f"\nTotal actual: ${total:0.2f}"
        else:
            cart_block = "(carrito vacío)"
        instrucciones = (instrucciones or "") + "\n\nCurrent customer cart:\n" + cart_block

        status_num = ORDER_STATUS.get(client_id, compute_base_status_for_client(client_id))
        status_map = {
            0: "0 (cart empty)",
            1: "1 (cart has items)",
            2: "2 (cart modal open)",
            3: "3 (checkout form open)",
            4: "4 (checkout valid, ready to finalize)",
            5: "5 (order confirmation open)"
        }
        instrucciones += "\n\nCurrent order status:\n- " + status_map.get(status_num, str(status_num))

    tools = [
        {
            "type": "function",
            "name": "update_front",
            "description": "Update the client UI to show only the given item names in real time, and include a short reply to speak to the user.",
            "parameters": {
                "type": "object",
                "properties": {
                    "names": {"type": "array","items": {"type": "string"}},
                    "reply": {"type": "string"}
                },
                "required": ["names", "reply"]
            }
        },
        {
            "type": "function",
            "name": "update_cart",
            "description": (
                "Add/remove items in the user's cart, or clear it. "
                "Use `action`: 'apply' (default) or 'clear'. "
                "Always include a short `reply` when appropriate."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["apply", "clear"] },
                    "ops": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "op": {"type": "string", "enum": ["add", "remove", "set", "clear"]},
                                "name":{"type": "string"},
                                "qty": {"type": "integer", "minimum": 0}
                            },
                            "required": ["op"]
                        }
                    },
                    "reply": {"type": "string"}
                }
            }
        },
        {
            "type": "function",
            "name": "get_cart",
            "description": "Return the current cart state with item names, qty, unit prices and total. Always include a short reply.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reply": {"type":"string"}
                }
            }
        },
        {
            "type": "function",
            "name": "get_order_status",
            "description": "Return current order_status (0..5). ALWAYS call this before transition_order_status.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reply": { "type": "string" }
                }
            }
        },
        {
            "type": "function",
            "name": "transition_order_status",
            "description": (
                "Advance or adjust the order flow UI for the current customer "
                "(0:empty, 1:cart-with-items, 2:cart-open, 3:checkout-open, "
                "4:checkout-valid, 5:success). Optionally include 'prefill' when to ∈ {3,4}. "
                "Always include a short 'reply'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "to": { "type": "integer", "enum": [0,1,2,3,4,5] },
                    "prefill": {
                        "type": "object",
                        "properties": {
                            "name":  {"type": "string"},
                            "phone": {"type": "string"},
                            "email": {"type": "string"},
                            "card":  {"type": "string"},
                            "exp":   {"type": "string"},
                            "cvv":   {"type": "string"}
                        }
                    },
                    "reply": { "type": "string" }
                },
                "required": ["to", "reply"]
            }
        }
    ]

    try:
        r = requests.post(
            "https://api.openai.com/v1/realtime/sessions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
                "OpenAI-Beta": "realtime=v1",
            },
            json={ "model": model, "voice": voice, "instructions": instrucciones, "tools": tools },
            timeout=20,
        )
    except requests.RequestException as e:
        return {"error": f"Realtime request failed: {e}"}, 502

    if r.status_code >= 400:
        return {"error": f"{r.status_code}: {r.text}"}, r.status_code
    return r.json()

# ======================
# API order_status
# ======================

@app.get("/api/order_status")
def get_order_status():
    client_id = (request.args.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "missing client_id"}, 400
    cur = ORDER_STATUS.get(client_id, compute_base_status_for_client(client_id))
    return {"ok": True, "status": cur}

@app.post("/api/order_status/transition")
def order_status_transition():
    """
    Body:
    {
      "client_id": "...",
      "from": 1,           # opcional (optimista)
      "to": 3|4,           # checkout open / ready
      "prefill": {         # opcional (puede ser parcial; se fusiona y valida)
        "name": "", "phone": "", "email": "",
        "card": "", "exp": "MM/YY", "cvv": ""
      }
    }
    """
    body = request.get_json(silent=True) or {}
    client_id = str(body.get("client_id") or "").strip()
    if not client_id:
        return {"ok": False, "error": "missing client_id"}, 400

    to = body.get("to", None)
    if to is None:
        return {"ok": False, "error": "missing 'to' state"}, 400
    to = int(to)

    cur = ORDER_STATUS.get(client_id, compute_base_status_for_client(client_id))
    from_state = body.get("from", None)
    if from_state is not None and int(from_state) != cur:
        return {"ok": False, "error": "state_conflict", "current": cur, "requested_from": int(from_state)}, 409

    cart = CARTS.get(client_id, [])
    extra_emit = {}

    def emit_status(s, extra=None):
        return set_order_status(client_id, s, announce=True, extra=extra)

    if to == 0:
        if len(cart) != 0:
            return {"ok": False, "error": "Cart is not empty", "current": cur}, 400
        res = emit_status(0)
        return {"ok": True, "status": 0, "changed": res["changed"]}

    if to == 1:
        if len(cart) == 0:
            return {"ok": False, "error": "Cart is empty", "current": cur}, 400
        res = emit_status(1)
        return {"ok": True, "status": 1, "changed": res["changed"]}

    if to == 2:
        if len(cart) == 0:
            return {"ok": False, "error": "Cart is empty", "current": cur}, 400
        res = emit_status(2)
        return {"ok": True, "status": 2, "changed": res["changed"]}

    # ------ NUEVO: manejo de prefill parcial y persistente ------
    if to in (3, 4):
        if len(cart) == 0:
            return {"ok": False, "error": "Cart is empty", "current": cur}, 400

        prefill_patch = body.get("prefill")

        # Si viene parche, lo fusionamos con lo que ya haya y decidimos estado.
        if prefill_patch:
            ok, missing, merged_raw = merge_prefill_patch(client_id, prefill_patch)
            if ok:
                extra_emit.update({"prefill": dict(merged_raw)})
                res = emit_status(4, extra=extra_emit)
                return {
                    "ok": True,
                    "status": 4,
                    "changed": res["changed"],
                    "applied_prefill": True,
                    "missing": [],
                    "prefill": dict(merged_raw)
                }
            else:
                extra_emit.update({"prefill": dict(merged_raw), "missing": list(missing)})
                res = emit_status(3, extra=extra_emit)
                return {
                    "ok": True,
                    "status": 3,
                    "changed": res["changed"],
                    "applied_prefill": False,
                    "missing": list(missing),
                    "prefill": dict(merged_raw)
                }

        # Sin parche: abrir 3 con lo que haya guardado y sus faltantes,
        # o promover a 4 si ya estaba completo.
        st = CHECKOUT_PREFILL.get(client_id, {"raw": {}, "valid": False})
        raw = dict(st.get("raw") or {})
        ok, missing, _cleaned = validate_prefill(raw)

        if to == 3:
            extra_emit.update({"prefill": dict(raw)})
            if not ok:
                extra_emit["missing"] = list(missing)
            res = emit_status(3, extra=extra_emit)
            return {
                "ok": True,
                "status": 3,
                "changed": res["changed"],
                "applied_prefill": False,
                "missing": [] if ok else list(missing),
                "prefill": dict(raw)
            }

        # to == 4 sin prefill explícito
        if ok:
            extra_emit.update({"prefill": dict(raw)})
            res = emit_status(4, extra=extra_emit)
            return {
                "ok": True,
                "status": 4,
                "changed": res["changed"],
                "applied_prefill": True,
                "missing": [],
                "prefill": dict(raw)
            }
        else:
            extra_emit.update({"prefill": dict(raw), "missing": list(missing)})
            res = emit_status(3, extra=extra_emit)
            return {
                "ok": True,
                "status": 3,
                "changed": res["changed"],
                "applied_prefill": False,
                "missing": list(missing),
                "prefill": dict(raw)
            }

    if to == 5:
        if cur != 4:
            return {"ok": False, "error": "Invalid transition (must be 4 -> 5)", "current": cur}, 409
        res = emit_status(5)
        return {"ok": True, "status": 5, "changed": res["changed"]}

    return {"ok": False, "error": "Unknown 'to' state"}, 400

if __name__ == "__main__":
    socketio.run(app, debug=True)
