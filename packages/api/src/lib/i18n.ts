type Locale = "ko" | "en";

type Messages = Record<string, string>;

const locales: Record<Locale, Messages> = {
  en: {
    // Delivery / notifications
    "delivery.email_subject": "[Conceal] {subject}",
    "delivery.email_body_text": "Priority: {score}/100\n\n{summary}",
    "delivery.email_body_html": "<p><strong>Priority:</strong> {score}/100</p><p>{summary}</p>",
    "delivery.slack_text": "📧 {summary}\nPriority: {score}/100",
    "delivery.slack_username": "Conceal Email",
    "delivery.test_summary": "🔔 Test delivery from Conceal",

    // Onboarding forwarding guide — Gmail
    "forwarding.gmail.display_name": "Gmail",
    "forwarding.gmail.steps.0": "Open Gmail Settings → See all settings → Forwarding and POP/IMAP",
    "forwarding.gmail.steps.1": "Click 'Add a forwarding address' and enter the forwarding address below",
    "forwarding.gmail.steps.2": "Check your Conceal inbox for the confirmation code from Google",
    "forwarding.gmail.steps.3": "Enter the confirmation code in Gmail and click Proceed",
    "forwarding.gmail.steps.4": "Select 'Forward a copy of incoming mail' and choose what to do with originals (Keep / Mark as read / Delete)",
    "forwarding.gmail.steps.5": "Click Save Changes",
    "forwarding.gmail.notes": "Gmail forwards all incoming mail. Use server-side filters in Gmail to forward only specific categories (e.g. newsletters) for more targeted control.",

    // Onboarding forwarding guide — Outlook
    "forwarding.outlook.display_name": "Outlook / Microsoft 365",
    "forwarding.outlook.steps.0": "Go to Outlook Settings (gear icon) → View all Outlook settings",
    "forwarding.outlook.steps.1": "Navigate to Mail → Forwarding",
    "forwarding.outlook.steps.2": "Enable 'Enable forwarding' and enter the forwarding address below",
    "forwarding.outlook.steps.3": "Optionally enable 'Keep a copy of forwarded messages'",
    "forwarding.outlook.steps.4": "Click Save",
    "forwarding.outlook.notes": "Microsoft 365 business accounts may require an admin to enable external forwarding. Contact your IT department if the option is grayed out.",

    // Onboarding forwarding guide — Yahoo
    "forwarding.yahoo.display_name": "Yahoo Mail",
    "forwarding.yahoo.steps.0": "Open Yahoo Mail Settings → More Settings → Mailboxes",
    "forwarding.yahoo.steps.1": "Select your Yahoo email address",
    "forwarding.yahoo.steps.2": "Scroll to 'Forwarding' and enter the forwarding address below",
    "forwarding.yahoo.steps.3": "Click Verify and follow the verification link in your inbox",
    "forwarding.yahoo.steps.4": "Return to Settings and enable forwarding",

    // Onboarding forwarding guide — iCloud
    "forwarding.icloud.display_name": "iCloud Mail",
    "forwarding.icloud.steps.0": "Sign in to iCloud.com and open Mail",
    "forwarding.icloud.steps.1": "Click the Settings gear → Preferences → General",
    "forwarding.icloud.steps.2": "Check 'Forward my email to' and enter the forwarding address below",
    "forwarding.icloud.steps.3": "Click Done",

    // Onboarding forwarding guide — ProtonMail
    "forwarding.protonmail.display_name": "Proton Mail",
    "forwarding.protonmail.steps.0": "Open Proton Mail Settings → All settings → Email → Auto-forwarding (Proton Unlimited or Business plan required)",
    "forwarding.protonmail.steps.1": "Click 'Add forwarding rule'",
    "forwarding.protonmail.steps.2": "Enter the forwarding address and select which messages to forward",
    "forwarding.protonmail.steps.3": "Verify your ownership via the confirmation email sent to the forwarding address",
    "forwarding.protonmail.steps.4": "Enable the forwarding rule",
    "forwarding.protonmail.notes": "Auto-forwarding in Proton Mail requires a paid plan. Free accounts can use IMAP connection instead via the 'Add email account' option.",

    // Mobile config profile strings
    "mdm.ios.payload_description": "Configures IMAP email account",
    "mdm.ios.profile_description": "Conceal Email Configuration",
    "mdm.ios.profile_display_name": "Conceal Email Setup",
    "mdm.ios.organization": "Conceal",
    "mdm.ios.account_description_suffix": "via Conceal",

    // Android setup instructions
    "android.setup.steps.0": "Open Gmail / Samsung Email / your preferred mail app on Android",
    "android.setup.steps.1": "Add account → Other",
    "android.setup.steps.2": "Enter your email address and tap Next",
    "android.setup.steps.3": "Select IMAP",
    "android.setup.steps.4": "Enter the incoming server settings below",
    "android.setup.steps.5": "Enter the outgoing server settings below",
    "android.setup.steps.6": "Follow any remaining prompts to complete setup",
  },
  ko: {
    // Delivery / notifications
    "delivery.email_subject": "[Conceal] {subject}",
    "delivery.email_body_text": "우선순위: {score}/100\n\n{summary}",
    "delivery.email_body_html": "<p><strong>우선순위:</strong> {score}/100</p><p>{summary}</p>",
    "delivery.slack_text": "📧 {summary}\n우선순위: {score}/100",
    "delivery.slack_username": "Conceal 이메일",
    "delivery.test_summary": "🔔 Conceal 테스트 알림입니다",

    // Onboarding forwarding guide — Gmail
    "forwarding.gmail.display_name": "Gmail",
    "forwarding.gmail.steps.0": "Gmail 설정 → 전체 설정 보기 → 전달 및 POP/IMAP을 엽니다",
    "forwarding.gmail.steps.1": "'전달 주소 추가'를 클릭하고 아래 전달 주소를 입력합니다",
    "forwarding.gmail.steps.2": "Google에서 보낸 확인 코드를 Conceal 받은편지함에서 확인합니다",
    "forwarding.gmail.steps.3": "Gmail에 확인 코드를 입력하고 '진행'을 클릭합니다",
    "forwarding.gmail.steps.4": "'수신 메일 복사본 전달'을 선택하고 원본 처리 방법을 선택합니다 (보관 / 읽음 표시 / 삭제)",
    "forwarding.gmail.steps.5": "'변경사항 저장'을 클릭합니다",
    "forwarding.gmail.notes": "Gmail은 수신되는 모든 메일을 전달합니다. 특정 카테고리(예: 뉴스레터)만 전달하려면 Gmail 서버 필터를 사용하세요.",

    // Onboarding forwarding guide — Outlook
    "forwarding.outlook.display_name": "Outlook / Microsoft 365",
    "forwarding.outlook.steps.0": "Outlook 설정(톱니바퀴 아이콘) → 모든 Outlook 설정 보기로 이동합니다",
    "forwarding.outlook.steps.1": "메일 → 전달로 이동합니다",
    "forwarding.outlook.steps.2": "'전달 사용'을 활성화하고 아래 전달 주소를 입력합니다",
    "forwarding.outlook.steps.3": "선택적으로 '전달된 메시지의 복사본 보관'을 활성화합니다",
    "forwarding.outlook.steps.4": "'저장'을 클릭합니다",
    "forwarding.outlook.notes": "Microsoft 365 비즈니스 계정은 외부 전달을 활성화하려면 관리자 권한이 필요할 수 있습니다. 옵션이 비활성화된 경우 IT 부서에 문의하세요.",

    // Onboarding forwarding guide — Yahoo
    "forwarding.yahoo.display_name": "Yahoo 메일",
    "forwarding.yahoo.steps.0": "Yahoo 메일 설정 → 더 많은 설정 → 사서함을 엽니다",
    "forwarding.yahoo.steps.1": "Yahoo 이메일 주소를 선택합니다",
    "forwarding.yahoo.steps.2": "'전달'로 스크롤하여 아래 전달 주소를 입력합니다",
    "forwarding.yahoo.steps.3": "'확인'을 클릭하고 받은편지함의 확인 링크를 따라갑니다",
    "forwarding.yahoo.steps.4": "설정으로 돌아가 전달을 활성화합니다",

    // Onboarding forwarding guide — iCloud
    "forwarding.icloud.display_name": "iCloud 메일",
    "forwarding.icloud.steps.0": "iCloud.com에 로그인하여 메일을 엽니다",
    "forwarding.icloud.steps.1": "설정 톱니바퀴 → 환경설정 → 일반을 클릭합니다",
    "forwarding.icloud.steps.2": "'내 이메일 전달 대상'을 선택하고 아래 전달 주소를 입력합니다",
    "forwarding.icloud.steps.3": "'완료'를 클릭합니다",

    // Onboarding forwarding guide — ProtonMail
    "forwarding.protonmail.display_name": "Proton 메일",
    "forwarding.protonmail.steps.0": "Proton 메일 설정 → 전체 설정 → 이메일 → 자동 전달(Proton Unlimited 또는 Business 플랜 필요)을 엽니다",
    "forwarding.protonmail.steps.1": "'전달 규칙 추가'를 클릭합니다",
    "forwarding.protonmail.steps.2": "전달 주소를 입력하고 전달할 메시지를 선택합니다",
    "forwarding.protonmail.steps.3": "전달 주소로 전송된 확인 이메일을 통해 소유권을 확인합니다",
    "forwarding.protonmail.steps.4": "전달 규칙을 활성화합니다",
    "forwarding.protonmail.notes": "Proton 메일의 자동 전달은 유료 플랜이 필요합니다. 무료 계정은 '이메일 계정 추가' 옵션을 통해 IMAP 연결을 사용할 수 있습니다.",

    // Mobile config profile strings
    "mdm.ios.payload_description": "IMAP 이메일 계정 설정",
    "mdm.ios.profile_description": "Conceal 이메일 설정",
    "mdm.ios.profile_display_name": "Conceal 이메일 설정",
    "mdm.ios.organization": "Conceal",
    "mdm.ios.account_description_suffix": "Conceal을 통해",

    // Android setup instructions
    "android.setup.steps.0": "Android에서 Gmail / Samsung 이메일 / 선호하는 메일 앱을 엽니다",
    "android.setup.steps.1": "계정 추가 → 기타를 선택합니다",
    "android.setup.steps.2": "이메일 주소를 입력하고 다음을 탭합니다",
    "android.setup.steps.3": "IMAP을 선택합니다",
    "android.setup.steps.4": "아래 수신 서버 설정을 입력합니다",
    "android.setup.steps.5": "아래 발신 서버 설정을 입력합니다",
    "android.setup.steps.6": "나머지 안내에 따라 설정을 완료합니다",
  },
};

function resolveLocale(locale: string): Locale {
  return locale === "ko" ? "ko" : "en";
}

export function t(key: string, locale: string, vars?: Record<string, string | number>): string {
  const resolved = resolveLocale(locale);
  const messages = locales[resolved];
  let value = messages[key] ?? locales.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return value;
}

export function tSteps(prefix: string, locale: string): string[] {
  const resolved = resolveLocale(locale);
  const messages = locales[resolved];
  const steps: string[] = [];
  let i = 0;
  while (messages[`${prefix}.${i}`] ?? locales.en[`${prefix}.${i}`]) {
    steps.push(messages[`${prefix}.${i}`] ?? locales.en[`${prefix}.${i}`]);
    i++;
  }
  return steps;
}
