const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export async function api(path, options = {}) {
  const token = sessionStorage.getItem("attendance_token");
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      message = body.detail || message;
    } catch {
      // Keep the HTTP status message if the server response is not JSON.
    }
    throw new Error(message);
  }
  if (response.headers.get("content-type")?.includes("text/csv")) return response.blob();
  return response.status === 204 ? null : response.json();
}

export const json = (method, body) => ({ method, body: JSON.stringify(body) });
