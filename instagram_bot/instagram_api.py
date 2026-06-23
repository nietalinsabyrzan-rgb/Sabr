import os
import requests
# pyrefly: ignore [missing-import]
from dotenv import load_dotenv

load_dotenv()

META_ACCESS_TOKEN = os.getenv("META_ACCESS_TOKEN")

def reply_to_comment(comment_id: str, reply_text: str):
    """
    Отправляет ответ на комментарий с помощью Instagram Graph API.
    Документация: https://developers.facebook.com/docs/instagram-api/reference/ig-comment/replies
    """
    if not META_ACCESS_TOKEN:
        print("Ошибка: META_ACCESS_TOKEN не установлен. Ответ не будет отправлен.")
        return False
        
    url = f"https://graph.facebook.com/v19.0/{comment_id}/replies"
    
    payload = {
        "message": reply_text,
        "access_token": META_ACCESS_TOKEN
    }
    
    try:
        response = requests.post(url, data=payload)
        response.raise_for_status()
        print(f"✅ Успешно отправлен ответ на комментарий {comment_id}")
        return True
    except requests.exceptions.RequestException as e:
        print(f"❌ Ошибка при отправке ответа: {e}")
        if e.response is not None:
            print(e.response.json())
        return False

def send_dm_reply(recipient_id: str, reply_text: str):
    """
    Отправляет ответ в личные сообщения (Direct) через Instagram Send API.
    Документация: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api
    """
    if not META_ACCESS_TOKEN:
        print("Ошибка: META_ACCESS_TOKEN не установлен. DM не будет отправлен.")
        return False

    # Instagram account ID из переменной среды
    instagram_account_id = os.getenv("INSTAGRAM_ACCOUNT_ID", "17841425564825585")

    # Правильный endpoint для Instagram Messaging API
    url = f"https://graph.facebook.com/v21.0/{instagram_account_id}/messages"

    payload = {
        "recipient": {"id": recipient_id},
        "message": {"text": reply_text},
        "messaging_type": "RESPONSE",
        "access_token": META_ACCESS_TOKEN
    }

    try:
        response = requests.post(url, json=payload)
        response.raise_for_status()
        print(f"✅ Успешно отправлен DM пользователю {recipient_id}")
        return True
    except requests.exceptions.RequestException as e:
        print(f"❌ Ошибка при отправке DM: {e}")
        if e.response is not None:
            print(e.response.json())
        return False


