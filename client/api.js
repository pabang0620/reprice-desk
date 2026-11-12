async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({ success: false, message: 'The server sent an unreadable answer.' }))
  if (!res.ok || json.success === false) throw new Error(json.message || `Request failed (${res.status})`)
  return json.data
}

export const api = {
  get: (url) => request('GET', url),
  put: (url, body) => request('PUT', url, body),
  post: (url, body) => request('POST', url, body ?? {}),
}
