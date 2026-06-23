import os
# pyrefly: ignore [missing-import]
from fastapi import FastAPI, Request, HTTPException, Query
# pyrefly: ignore [missing-import]
from fastapi.responses import PlainTextResponse
from dotenv import load_dotenv
# pyrefly: ignore [missing-import]
from instagram_api import reply_to_comment, send_dm_reply
# pyrefly: ignore [missing-import]
from analyzer import is_negative_comment, generate_reply, generate_dm_reply
from collections import defaultdict

load_dotenv()

app = FastAPI(title="Instagram Moderation Bot")

# Словарь для хранения истории сообщений (в памяти)
# Формат: {"sender_id": [{"role": "user", "text": "..."}, {"role": "bot", "text": "..."}]}
dm_sessions = defaultdict(list)
MAX_HISTORY = 6 # храним последние 6 сообщений (3 обмена репликами)

def process_dm(sender_id: str, message_text: str):
    """Вспомогательная функция для обработки входящих DM с учетом контекста"""
    if sender_id == INSTAGRAM_ACCOUNT_ID:
        return
    if not message_text:
        print(f"📩 Получено DM без текста от {sender_id}. Пропускаем.")
        return

    print(f"📩 Новое DM от {sender_id}: {message_text}")

    # Собираем историю диалога в текстовый формат
    history = dm_sessions[sender_id]
    history_text = "\n".join([f"{'Клиент' if msg['role'] == 'user' else 'Бот'}: {msg['text']}" for msg in history])
    
    reply_text = generate_dm_reply(message_text, history_text)
    
    # Добавляем в историю
    dm_sessions[sender_id].append({"role": "user", "text": message_text})
    if reply_text:
        dm_sessions[sender_id].append({"role": "bot", "text": reply_text})
        
    # Обрезаем историю, чтобы не переполнять память
    if len(dm_sessions[sender_id]) > MAX_HISTORY:
        dm_sessions[sender_id] = dm_sessions[sender_id][-MAX_HISTORY:]

    send_dm_reply(sender_id, reply_text)

META_VERIFY_TOKEN = os.getenv("META_VERIFY_TOKEN", "my_super_secret_verify_token")
# ID нашего Instagram бизнес-аккаунта, чтобы не отвечать самим себе
INSTAGRAM_ACCOUNT_ID = os.getenv("INSTAGRAM_ACCOUNT_ID", "17841425564825585")

@app.get("/")
def read_root():
    return {"status": "ok", "message": "Instagram Bot is running."}

@app.get("/webhook")
def verify_webhook(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
    hub_verify_token: str = Query(None, alias="hub.verify_token")
):
    """
    Эндпоинт для верификации вебхука серверами Meta.
    """
    if hub_mode == "subscribe" and hub_verify_token == META_VERIFY_TOKEN:
        print("Webhook verified successfully!")
        return PlainTextResponse(hub_challenge)
    raise HTTPException(status_code=403, detail="Verification token mismatch")

@app.post("/webhook")
async def handle_webhook(request: Request):
    """
    Эндпоинт для обработки входящих событий (комментарии и личные сообщения).
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    # DEBUG: логируем весь входящий payload
    import json as _json
    print(f"🔍 Webhook payload: {_json.dumps(body, ensure_ascii=False)[:800]}")

    # Meta отправляет данные в виде массива entry
    if "entry" in body:
        for entry in body["entry"]:
            changes = entry.get("changes", [])
            for change in changes:
                field = change.get("field", "")
                value = change.get("value", {})

                # === ОБРАБОТКА КОММЕНТАРИЕВ ===
                if field == "comments":
                    comment_text = value.get("text", "")
                    comment_id = value.get("id")

                    if not comment_text or not comment_id:
                        continue

                    print(f"Новый комментарий [{comment_id}]: {comment_text}")

                    if is_negative_comment(comment_text):
                        print(f"⚠️ Обнаружен негативный комментарий: {comment_text}")
                        reply_text = generate_reply(comment_text)
                        reply_to_comment(comment_id, reply_text)
                    else:
                        print("Комментарий нейтральный или позитивный. Игнорируем.")

                # === ОБРАБОТКА ЛИЧНЫХ СООБЩЕНИЙ (DM) ===
                elif field == "messages":
                    sender_id = value.get("sender", {}).get("id", "")
                    message = value.get("message", {})
                    message_text = message.get("text", "")
                    
                    process_dm(sender_id, message_text)

            # === ОБРАБОТКА РЕАЛЬНЫХ DM (приходят через messaging, а не changes) ===
            for message_event in entry.get("messaging", []):
                sender_id = message_event.get("sender", {}).get("id", "")
                message = message_event.get("message", {})
                message_text = message.get("text", "")
                
                process_dm(sender_id, message_text)

    return {"status": "success"}
