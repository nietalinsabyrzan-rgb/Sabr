# Signature Detector

Приложение ищет подписи и печати в PDF/картинках.

## Запуск

Открой терминал в этой папке и выполни:

```bash
python3 -m pip install -r requirements.txt
python3 main.py
```

В VS Code можно открыть папку и нажать Run на `main.py`.

## Какие кнопки использовать

- `Best PDF` - выбрать PDF вручную, ищет подписи и печати.
- `Desktop Best` - сканирует PDF с рабочего стола.
- `Choose ONNX` - запускает локальную ONNX-модель.
- `Good ONNX` - проверяет тестовые документы из папки `good_signature_docs`.

## Цвета рамок

- Красный - подпись.
- Синий - печать.
