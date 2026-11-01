// Browser-side API helpers. Auth relies solely on the HttpOnly session cookie;
// no token or password is ever stored in localStorage/sessionStorage.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

/** Network failures, 5xx, 408, 429 and 401 are retried; other 4xx are permanent. */
export const isRetryable = (e: unknown) =>
  !(e instanceof ApiError) || e.status >= 500 || e.status === 408 || e.status === 429 || e.status === 401;

let redirecting = false;
export function goToLogin() {
  if (redirecting || typeof window === "undefined") return;
  redirecting = true;
  const next = window.location.pathname + window.location.search;
  window.location.replace(`/login?next=${encodeURIComponent(next)}`);
}

// 401 on these endpoints means "wrong credentials", not "session expired".
const AUTH_FORMS = ["/api/auth/login", "/api/auth/register"];

export async function api<T = unknown>(
  url: string,
  opts: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { "x-fid-csrf": "1" };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, {
    method: opts.method ?? (body ? "POST" : "GET"),
    headers,
    body,
    credentials: "same-origin",
    cache: "no-store",
    signal: opts.signal,
  });
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    if (res.status === 401 && !AUTH_FORMS.some((p) => url.startsWith(p))) goToLogin();
    throw new ApiError(res.status, typeof data?.error === "string" ? data.error : `http_${res.status}`);
  }
  return data as T;
}

/** Multipart upload with progress (XHR), same CSRF header and cookie-based auth. */
export function upload<T>(url: string, form: FormData, onProgress?: (p: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.setRequestHeader("x-fid-csrf", "1");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: { error?: string } | null = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else {
        if (xhr.status === 401) goToLogin();
        reject(new ApiError(xhr.status, data?.error ?? `http_${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new TypeError("network_error"));
    xhr.ontimeout = () => reject(new TypeError("network_timeout"));
    xhr.send(form);
  });
}

export function newClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

const ERRORS: Record<string, string> = {
  invalid_credentials: "البريد الإلكتروني أو كلمة المرور غير صحيحة",
  too_many_requests: "محاولات كثيرة — حاول لاحقًا",
  email_or_username_taken: "البريد الإلكتروني أو اسم المستخدم مستخدم بالفعل",
  weak_password: "كلمة المرور ضعيفة (8 أحرف على الأقل)",
  invalid_username: "اسم المستخدم: أحرف إنجليزية صغيرة وأرقام و _ . (3-30)",
  invalid_email: "البريد الإلكتروني غير صالح",
  invalid_display_name: "اسم العرض مطلوب",
  username_taken: "اسم المستخدم مستخدم بالفعل",
  wrong_password: "كلمة المرور غير صحيحة",
  file_too_large: "حجم الملف أكبر من المسموح",
  friends_only: "هذا المستخدم يستقبل الرسائل من الأصدقاء فقط — أرسل طلب صداقة أولاً",
  you_blocked_user: "لقد حظرت هذا المستخدم — ألغِ الحظر أولاً",
  cannot_message_user: "لا يمكن إرسال رسائل إلى هذا المستخدم",
  user_not_found: "المستخدم غير موجود",
  edit_window_expired: "انتهت مهلة التعديل (15 دقيقة)",
  delete_window_expired: "انتهت مهلة الحذف لدى الجميع (48 ساعة)",
  empty_message: "الرسالة فارغة",
  message_too_long: "الرسالة طويلة جدًا",
  invalid_image: "صيغة الصورة غير مدعومة",
  not_found: "غير موجود أو لا تملك صلاحية الوصول",
  csrf_check_failed: "تم رفض الطلب لأسباب أمنية",
};

export function describeError(e: unknown) {
  if (e instanceof ApiError) return ERRORS[e.code] ?? "حدث خطأ، حاول مجددًا";
  return "تعذّر الاتصال بالخادم";
}
