type Locale = "ko" | "en";

const messages: Record<Locale, Record<string, string>> = {
  en: {
    "delivery.email_subject": "[Conceal] {subject}",
    "delivery.email_body_text": "Priority: {score}/100\n\n{summary}",
    "delivery.email_body_html": "<p><strong>Priority:</strong> {score}/100</p><p>{summary}</p>",
    "delivery.slack_text": "📧 {summary}\nPriority: {score}/100",
    "delivery.slack_username": "Conceal Email",
    "delivery.test_summary": "🔔 Test delivery from Conceal",
  },
  ko: {
    "delivery.email_subject": "[Conceal] {subject}",
    "delivery.email_body_text": "우선순위: {score}/100\n\n{summary}",
    "delivery.email_body_html": "<p><strong>우선순위:</strong> {score}/100</p><p>{summary}</p>",
    "delivery.slack_text": "📧 {summary}\n우선순위: {score}/100",
    "delivery.slack_username": "Conceal 이메일",
    "delivery.test_summary": "🔔 Conceal 테스트 알림입니다",
  },
};

function resolveLocale(locale: string): Locale {
  return locale === "ko" ? "ko" : "en";
}

export function t(key: string, locale: string, vars?: Record<string, string | number>): string {
  const resolved = resolveLocale(locale);
  let value = messages[resolved][key] ?? messages.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return value;
}
