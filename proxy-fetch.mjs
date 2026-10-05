const clients = new Map();

export function describeProxy(proxyUrl) {
  try {
    const { protocol, host } = new URL(proxyUrl);
    return `${protocol}//${host}`;
  } catch {
    return "некорректный адрес";
  }
}

export async function createFetch(proxyUrl) {
  const raw = String(proxyUrl || "").trim();
  if (!raw) return fetch;

  let client = clients.get(raw);
  if (!client) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error("Адрес прокси задан неверно. Формат: socks5://логин:пароль@адрес:порт или http://логин:пароль@адрес:порт");
    }

    let undici;
    try {
      undici = await import("undici");
    } catch {
      throw new Error("Для работы через прокси нужен пакет undici: выполните npm install.");
    }

    let dispatcher;
    if (/^socks5h?:$|^socks:$/.test(parsed.protocol)) {
      // undici принимает только socks5://; имя сайта и так передаётся прокси, а не разрешается локально
      parsed.protocol = "socks5:";
      dispatcher = new undici.Socks5ProxyAgent(parsed.toString());
    } else if (/^https?:$/.test(parsed.protocol)) {
      dispatcher = new undici.ProxyAgent(raw);
    } else {
      throw new Error(`Тип прокси ${parsed.protocol} не поддерживается. Используйте socks5:// или http://`);
    }

    client = { fetch: undici.fetch, dispatcher };
    clients.set(raw, client);
  }
  return (target, options = {}) => client.fetch(target, { ...options, dispatcher: client.dispatcher });
}
