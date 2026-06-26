export function latestClientMessage(text: string): string {
  const match = /Новое короткое сообщение клиента:\s*\n"([^"]*)"/u.exec(text);
  return match?.[1]?.trim() || text;
}
