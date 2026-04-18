#!/usr/bin/env tsx
/**
 * 500건 실데이터 기반 그루핑 테스트 스크립트
 *
 * 현실적인 500건 이메일 데이터셋 생성 후 분류+그루핑 파이프라인 실행.
 * 업무별 그룹 정확도 측정 및 리포트 출력.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=<key> npx tsx packages/worker/test-grouping-500.ts
 *
 * Options (env vars):
 *   CONCURRENCY=10      Number of parallel LLM calls (default: 10)
 *   DRY_RUN=1           Skip real LLM calls; simulate perfect classification
 */

import { classifyPhase2 } from "./src/classifier-phase2.js";
import { groupEmails } from "./src/email-grouper.js";
import type { EmailRecord } from "./src/email-grouper.js";
import type { WorkType, InformationalCategory } from "./src/classifier-phase2.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmailFixture {
  subject: string;
  senderDomain: string;
  senderLocalPart: string;
  sieveLabel: string | null;
  expectedWorkTypes: WorkType[];
  expectedCategory: InformationalCategory;
}

interface ClassifiedResult {
  fixture: EmailFixture;
  actualWorkTypes: WorkType[];
  actualCategory: InformationalCategory;
  ruleBased: boolean;
}

interface CategoryMetrics {
  workType: WorkType | "other";
  expected: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
}

// ── Dataset generation ────────────────────────────────────────────────────────

const CONTRACT_SUBJECTS = [
  "NDA 서명 요청 — 파트너십 계약",
  "Please sign: Master Service Agreement",
  "계약서 검토 요청 드립니다",
  "Software License Agreement — action required",
  "공급 계약서 수정본 전달",
  "Amendment to our Service Contract",
  "비밀유지계약(NDA) 체결 요청",
  "Lease Agreement — final version attached",
  "용역 계약서 최종본 확인 부탁드립니다",
  "Partnership Agreement — please review and sign",
  "계약 갱신 관련 안내",
  "Vendor Contract Renewal — expires next month",
  "MOU 초안 검토 요청",
  "Consulting Agreement — please countersign",
  "라이선스 계약 조건 변경 안내",
];

const CONTRACT_DOMAINS = [
  "docusign.com", "hellosign.com", "legal.example.com", "contracts.corp.com",
  "partner-co.com", "vendor.io", "lawfirm.co.kr", "sign.enterprise.com",
  "agreement.co", "legal.startup.io",
];

const MEETING_SUBJECTS = [
  "Q2 전략 미팅 일정 조율",
  "Meeting request: Product roadmap review",
  "Zoom call 일정 잡아드려도 될까요?",
  "Calendar invite: Weekly standup",
  "주간 정기 회의 안건 및 일정",
  "Let's schedule a call — availability?",
  "Google Meet: 투자자 미팅 확정",
  "Interview scheduling — please pick a slot",
  "Calendly: Book a 30-min demo",
  "팀 워크샵 날짜 조율 요청",
  "Board meeting — next Thursday 2PM",
  "분기별 리뷰 미팅 초대",
  "Call with the engineering team?",
  "커피챗 일정 조율 부탁드립니다",
  "All-hands meeting — save the date",
];

const MEETING_DOMAINS = [
  "calendly.com", "meet.google.com", "zoom.us", "teams.microsoft.com",
  "partner.com", "client.co.kr", "investor.vc", "recruiter.hr.com",
  "scheduling.app", "cal.com",
];

const CS_SUBJECTS = [
  "[Ticket #8821] 결제 오류 문의",
  "Support request: Unable to login",
  "고객센터 문의 — 환불 요청",
  "Help! My account is locked",
  "Re: Product defect — urgent",
  "[지원팀] 서비스 이용 불가 민원",
  "Customer complaint — order #4492",
  "A/S 접수 확인 메일",
  "Your support ticket has been updated",
  "고객 불만 접수: 배송 지연",
  "Refund request for invoice #2291",
  "긴급: 시스템 오류 신고",
  "[CS] 계정 복구 요청",
  "Service issue escalation — please respond",
  "앱 오류 신고 및 개선 요청",
];

const CS_DOMAINS = [
  "zendesk.com", "freshdesk.com", "intercom.io", "support.shopify.com",
  "helpdesk.saas.com", "cs.corp.co.kr", "ticket.platform.io",
  "complaints.gov.kr", "service.enterprise.com", "support.startup.io",
];

const REPORT_SUBJECTS = [
  "주간 업무 보고 — 4월 3주차",
  "Monthly analytics report: March 2026",
  "Q1 2026 실적 요약 보고서",
  "Weekly digest: Key metrics this week",
  "분기별 매출 현황 보고",
  "Product usage report — April 2026",
  "4월 마케팅 성과 보고서",
  "Executive summary: Revenue & growth",
  "서비스 운영 현황 월간 리포트",
  "A/B test results — landing page experiment",
  "팀 KPI 달성 현황 공유",
  "Quarterly business review — QBR slides",
  "데이터 분석 결과 공유합니다",
  "Weekly sales report — week ending Apr 18",
  "운영팀 월간 요약 보고",
];

const REPORT_DOMAINS = [
  "analytics.google.com", "looker.com", "tableau.com", "data.internal.co",
  "reports.corp.com", "bi.company.io", "metrics.platform.com",
  "analytics.saas.co", "insights.startup.io", "report.enterprise.kr",
];

const HIRING_SUBJECTS = [
  "[지원] 백엔드 개발자 — 김민준",
  "Job application: Senior Product Manager",
  "이력서 전달 드립니다 — 마케팅팀 지원",
  "Resume: Full-stack engineer position",
  "인터뷰 일정 확인 부탁드립니다",
  "Final interview — offer stage",
  "지원서 검토 요청 — 디자이너 포지션",
  "Reference check request",
  "채용 공고 문의 드립니다",
  "Offer letter — please review and sign",
  "헤드헌터 소개: 시니어 엔지니어 후보",
  "Candidate profile: CTO search",
  "인턴십 지원서 제출합니다",
  "Background check complete — results attached",
  "리크루터 연락 — LinkedIn 메시지",
];

const HIRING_DOMAINS = [
  "linkedin.com", "wanted.co.kr", "jobkorea.co.kr", "greenhouse.io",
  "lever.co", "workable.com", "hired.com", "saramin.co.kr",
  "recruit.naver.com", "headhunter.co.kr",
];

const PAYMENT_SUBJECTS = [
  "Invoice #INV-2026-0412 — due Apr 30",
  "영수증 발행 안내 — 3월 구독료",
  "결제 완료 확인서",
  "Payment reminder: overdue invoice",
  "월 구독 갱신 청구서",
  "Receipt for your purchase — $299",
  "세금계산서 발행 완료",
  "Invoice from AWS — April 2026",
  "Payment received — thank you",
  "미납금 안내 — 즉시 처리 바랍니다",
  "Billing statement: Q1 2026",
  "카드 결제 승인 안내",
  "Stripe: Subscription renewal invoice",
  "구매 영수증 — 주문 #ORD-99182",
  "Wire transfer confirmation",
];

const PAYMENT_DOMAINS = [
  "stripe.com", "paypal.com", "aws.amazon.com", "billing.google.com",
  "invoice.quickbooks.com", "xendit.co", "tosspayments.com",
  "billing.saas.com", "finance.corp.co.kr", "accounts.receivable.io",
];

const NEWSLETTER_SUBJECTS = [
  "This week in tech — April 2026",
  "뉴스레터: 이번 주 주목할 스타트업",
  "The weekly roundup from ProductHunt",
  "Morning Brew ☕ — Monday edition",
  "AI 트렌드 위클리 뉴스레터",
  "Your weekly digest from Substack",
  "Industry update: What you missed",
  "월간 인사이트 뉴스레터",
  "Hacker News digest — top stories",
  "개발자 커뮤니티 주간 소식",
];

const NEWSLETTER_DOMAINS = [
  "substack.com", "beehiiv.com", "mailchimp.com", "sendgrid.net",
  "constantcontact.com", "campaignmonitor.com", "klaviyo.com",
  "newsletter.io", "digest.weekly.com", "updates.media.co",
];

const SYSNOTIF_SUBJECTS = [
  "[Alert] CPU usage exceeded 90%",
  "GitHub Actions: Build #4421 failed",
  "Datadog: Anomaly detected in API latency",
  "서버 점검 안내 — 4월 20일 02:00~04:00",
  "PagerDuty: Incident #P-9912 resolved",
  "[Sentry] New error: TypeError in production",
  "AWS: Instance auto-scaling triggered",
  "Slack: Channel export complete",
  "Vercel: Deployment succeeded",
  "보안 로그인 알림 — 새 기기에서 접속",
];

const SYSNOTIF_DOMAINS = [
  "datadog.com", "pagerduty.com", "sentry.io", "github.com",
  "vercel.com", "aws.amazon.com", "cloudwatch.amazon.com",
  "monitoring.io", "alerts.platform.com", "notifications.corp.com",
];

function buildFixtures(): EmailFixture[] {
  const fixtures: EmailFixture[] = [];

  // Helper: pick template by cycling through array with variation
  function pick<T>(arr: T[], index: number): T {
    return arr[index % arr.length];
  }

  // Contract: 70 emails
  for (let i = 0; i < 70; i++) {
    fixtures.push({
      subject: pick(CONTRACT_SUBJECTS, i),
      senderDomain: pick(CONTRACT_DOMAINS, i),
      senderLocalPart: pick(["contracts", "legal", "admin", "info", "sign", "hello"], i),
      sieveLabel: null,
      expectedWorkTypes: ["contract"],
      expectedCategory: "action_required",
    });
  }

  // Meeting: 70 emails
  for (let i = 0; i < 70; i++) {
    fixtures.push({
      subject: pick(MEETING_SUBJECTS, i),
      senderDomain: pick(MEETING_DOMAINS, i),
      senderLocalPart: pick(["calendar", "invite", "hello", "meeting", "schedule", "team"], i),
      sieveLabel: null,
      expectedWorkTypes: ["meeting"],
      expectedCategory: "action_required",
    });
  }

  // CS: 70 emails
  for (let i = 0; i < 70; i++) {
    fixtures.push({
      subject: pick(CS_SUBJECTS, i),
      senderDomain: pick(CS_DOMAINS, i),
      senderLocalPart: pick(["support", "helpdesk", "cs", "service", "ticket", "agent"], i),
      sieveLabel: null,
      expectedWorkTypes: ["cs"],
      expectedCategory: "action_required",
    });
  }

  // Report: 70 emails
  for (let i = 0; i < 70; i++) {
    fixtures.push({
      subject: pick(REPORT_SUBJECTS, i),
      senderDomain: pick(REPORT_DOMAINS, i),
      senderLocalPart: pick(["reports", "analytics", "data", "insights", "bi", "metrics"], i),
      sieveLabel: null,
      expectedWorkTypes: ["report"],
      expectedCategory: "informational",
    });
  }

  // Hiring: 70 emails
  for (let i = 0; i < 70; i++) {
    fixtures.push({
      subject: pick(HIRING_SUBJECTS, i),
      senderDomain: pick(HIRING_DOMAINS, i),
      senderLocalPart: pick(["recruit", "hr", "talent", "careers", "apply", "jobs"], i),
      sieveLabel: null,
      expectedWorkTypes: ["hiring"],
      expectedCategory: "action_required",
    });
  }

  // Payment: 70 emails
  for (let i = 0; i < 70; i++) {
    fixtures.push({
      subject: pick(PAYMENT_SUBJECTS, i),
      senderDomain: pick(PAYMENT_DOMAINS, i),
      senderLocalPart: pick(["billing", "invoice", "payments", "finance", "accounts", "receipts"], i),
      sieveLabel: null,
      expectedWorkTypes: ["payment"],
      expectedCategory: "informational",
    });
  }

  // Newsletter: 60 emails (rule-based path — sieveLabel triggers fast path)
  for (let i = 0; i < 60; i++) {
    fixtures.push({
      subject: pick(NEWSLETTER_SUBJECTS, i),
      senderDomain: pick(NEWSLETTER_DOMAINS, i),
      senderLocalPart: pick(["newsletter", "digest", "weekly", "updates", "news"], i),
      sieveLabel: "newsletter",
      expectedWorkTypes: [],
      expectedCategory: "informational",
    });
  }

  // System notifications: 20 emails (rule-based path)
  for (let i = 0; i < 20; i++) {
    fixtures.push({
      subject: pick(SYSNOTIF_SUBJECTS, i),
      senderDomain: pick(SYSNOTIF_DOMAINS, i),
      senderLocalPart: pick(["noreply", "alerts", "notifications", "no-reply"], i),
      sieveLabel: "system_notification",
      expectedWorkTypes: [],
      expectedCategory: "informational",
    });
  }

  return fixtures;
}

// ── Concurrency util ──────────────────────────────────────────────────────────

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  onProgress?: (done: number, total: number) => void
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
      done++;
      onProgress?.(done, tasks.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

// ── Pipeline runner ───────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN === "1";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? "10");

async function classify(fixture: EmailFixture): Promise<ClassifiedResult> {
  if (DRY_RUN) {
    // Simulate perfect classification in dry-run mode
    return {
      fixture,
      actualWorkTypes: fixture.expectedWorkTypes as WorkType[],
      actualCategory: fixture.expectedCategory,
      ruleBased: fixture.sieveLabel === "newsletter" || fixture.sieveLabel === "system_notification",
    };
  }

  const result = await classifyPhase2(
    fixture.subject,
    fixture.senderDomain,
    fixture.senderLocalPart,
    fixture.sieveLabel
  );

  const isRuleBased =
    fixture.sieveLabel === "newsletter" ||
    fixture.sieveLabel === "system_notification" ||
    /^(noreply|no-reply|donotreply|notifications?|automated?|mailer-daemon|postmaster|bounce|alert|updates?)@/i.test(
      fixture.senderLocalPart + "@"
    );

  return {
    fixture,
    actualWorkTypes: result.workTypes as WorkType[],
    actualCategory: result.informationalCategory,
    ruleBased: isRuleBased,
  };
}

// ── Accuracy calculator ───────────────────────────────────────────────────────

const ALL_WORK_TYPES: Array<WorkType | "other"> = [
  "contract", "meeting", "cs", "report", "hiring", "payment", "other",
];

function computeMetrics(results: ClassifiedResult[]): CategoryMetrics[] {
  return ALL_WORK_TYPES.map((wt) => {
    let tp = 0, fp = 0, fn = 0;

    for (const r of results) {
      const expectedHas = r.fixture.expectedWorkTypes.includes(wt as WorkType);
      const actualHas = r.actualWorkTypes.includes(wt as WorkType);

      if (expectedHas && actualHas) tp++;
      else if (!expectedHas && actualHas) fp++;
      else if (expectedHas && !actualHas) fn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

    return {
      workType: wt,
      expected: tp + fn,
      tp,
      fp,
      fn,
      precision,
      recall,
      f1,
    };
  });
}

function computeCategoryAccuracy(results: ClassifiedResult[]): { correct: number; total: number; accuracy: number } {
  let correct = 0;
  for (const r of results) {
    if (r.actualCategory === r.fixture.expectedCategory) correct++;
  }
  return { correct, total: results.length, accuracy: correct / results.length };
}

// ── Report ────────────────────────────────────────────────────────────────────

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function bar(n: number, width = 20): string {
  const filled = Math.round(n * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function printReport(
  results: ClassifiedResult[],
  metrics: CategoryMetrics[],
  catAccuracy: { correct: number; total: number; accuracy: number },
  groupedView: ReturnType<typeof groupEmails>,
  elapsedMs: number
) {
  const ruleBasedCount = results.filter((r) => r.ruleBased).length;
  const llmCount = results.length - ruleBasedCount;

  console.log("\n" + "═".repeat(70));
  console.log("  500건 이메일 분류+그루핑 파이프라인 테스트 리포트");
  console.log("  " + new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }));
  console.log("═".repeat(70));

  console.log("\n📊 실행 요약");
  console.log(`  총 이메일:     ${results.length}건`);
  console.log(`  LLM 분류:      ${llmCount}건`);
  console.log(`  규칙 기반:     ${ruleBasedCount}건 (newsletter/system_notification)`);
  console.log(`  소요 시간:     ${(elapsedMs / 1000).toFixed(1)}초`);
  console.log(`  처리 속도:     ${((results.length / elapsedMs) * 1000).toFixed(1)}건/초`);
  if (!DRY_RUN) {
    console.log(`  동시 처리:     ${CONCURRENCY}개`);
  } else {
    console.log(`  모드:          DRY RUN (LLM 호출 없음)`);
  }

  console.log("\n🎯 업무 분류(Work Type) 정확도");
  console.log(
    "  " +
      "카테고리".padEnd(12) +
      "예상".padStart(6) +
      " TP".padStart(5) +
      " FP".padStart(5) +
      " FN".padStart(5) +
      " Prec".padStart(7) +
      " Rec".padStart(7) +
      " F1".padStart(7) +
      "  " +
      "F1 Bar"
  );
  console.log("  " + "─".repeat(68));

  for (const m of metrics) {
    if (m.expected === 0 && m.fp === 0) continue; // skip empty categories
    const row =
      "  " +
      m.workType.padEnd(12) +
      String(m.expected).padStart(6) +
      String(m.tp).padStart(5) +
      String(m.fp).padStart(5) +
      String(m.fn).padStart(5) +
      pct(m.precision).padStart(7) +
      pct(m.recall).padStart(7) +
      pct(m.f1).padStart(7) +
      "  " +
      bar(m.f1, 15);
    console.log(row);
  }

  const macroF1 =
    metrics.filter((m) => m.expected > 0).reduce((s, m) => s + m.f1, 0) /
    metrics.filter((m) => m.expected > 0).length;

  console.log("  " + "─".repeat(68));
  console.log(
    "  " +
      "매크로 평균".padEnd(12) +
      " ".repeat(21) +
      " ".padStart(5) +
      " ".padStart(7) +
      " ".padStart(7) +
      pct(macroF1).padStart(7)
  );

  console.log("\n📋 정보성 분류(Informational Category) 정확도");
  console.log(`  정답: ${catAccuracy.correct}건 / 전체: ${catAccuracy.total}건`);
  console.log(`  정확도: ${pct(catAccuracy.accuracy)}  ${bar(catAccuracy.accuracy)}`);

  console.log("\n📦 그루핑 결과 (groupEmails 출력)");
  console.log(`  총 이메일: ${groupedView.totalEmails}건`);
  console.log(`  긴급 메일: ${groupedView.urgent.count}건`);

  console.log("\n  업무별 그룹 (내림차순):");
  for (const g of groupedView.workTypes) {
    const pctOfTotal = g.count / groupedView.totalEmails;
    console.log(
      `    ${g.workType.padEnd(10)} ${String(g.count).padStart(4)}건  ${bar(pctOfTotal, 20)}  ${pct(pctOfTotal)}`
    );
  }

  console.log(`\n  발신자 도메인 TOP ${Math.min(10, groupedView.topSenders.length)}:`);
  for (const s of groupedView.topSenders.slice(0, 10)) {
    console.log(
      `    ${s.senderDomain.padEnd(30)} ${String(s.count).padStart(4)}건  labels: [${s.labels.join(", ")}]`
    );
  }

  console.log("\n✅ 분류 오류 샘플 (최대 10건):");
  const errors = results.filter((r) => {
    const expectedSet = new Set(r.fixture.expectedWorkTypes);
    const actualSet = new Set(r.actualWorkTypes);
    const sameSize = expectedSet.size === actualSet.size;
    const sameContent = [...expectedSet].every((t) => actualSet.has(t));
    return !(sameSize && sameContent);
  });

  if (errors.length === 0) {
    console.log("  오류 없음 🎉");
  } else {
    for (const e of errors.slice(0, 10)) {
      console.log(`  - "${e.fixture.subject.slice(0, 50)}"`);
      console.log(
        `    예상: [${e.fixture.expectedWorkTypes.join(", ") || "none"}]  실제: [${e.actualWorkTypes.join(", ")}]`
      );
    }
    console.log(`  (총 ${errors.length}건 오분류)`);
  }

  console.log("\n" + "═".repeat(70) + "\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 500건 이메일 그루핑 테스트 시작...");

  const fixtures = buildFixtures();
  console.log(`📧 데이터셋: ${fixtures.length}건 생성 완료`);

  if (!DRY_RUN && !process.env.ANTHROPIC_API_KEY) {
    console.error("❌ ANTHROPIC_API_KEY가 설정되지 않았습니다. DRY_RUN=1로 실행하거나 API 키를 설정하세요.");
    process.exit(1);
  }

  const startTime = Date.now();
  let lastPrintLen = 0;

  function onProgress(done: number, total: number) {
    const line = `\r  진행: ${done}/${total} (${Math.round((done / total) * 100)}%)`;
    process.stdout.write(line.padEnd(lastPrintLen));
    lastPrintLen = line.length;
  }

  const tasks = fixtures.map((f) => () => classify(f));
  const results = await runWithConcurrency(tasks, CONCURRENCY, onProgress);
  process.stdout.write("\r" + " ".repeat(lastPrintLen) + "\r");

  const elapsedMs = Date.now() - startTime;

  // Convert to EmailRecord for groupEmails
  const emailRecords: EmailRecord[] = results.map((r, i) => ({
    senderDomain: r.fixture.senderDomain,
    sieveLabel: r.fixture.sieveLabel ?? (r.actualCategory === "informational" ? "normal" : null),
    workTypes: r.actualWorkTypes,
    informationalCategory: r.actualCategory,
    priorityScore: null,
    summary: `[${r.actualWorkTypes.join("+")}] ${r.fixture.subject}`,
    receivedAt: new Date(Date.now() - i * 60_000).toISOString(),
  }));

  const groupedView = groupEmails(emailRecords);
  const metrics = computeMetrics(results);
  const catAccuracy = computeCategoryAccuracy(results);

  printReport(results, metrics, catAccuracy, groupedView, elapsedMs);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
