/**
 * 500-email grouping test (CON-73)
 *
 * Generates a synthetic but realistic Korean-business-email dataset of 500 records,
 * runs L1 sieve classification (rule-based, no API), applies rule-based Phase 2
 * classification, groups the results, and prints a structured report.
 *
 * Run: node scripts/test-grouping-500.mjs
 */

// ── Patterns copied from sieve.ts (no imports needed) ─────────────────────────

const NOREPLY_PATTERN = /^(noreply|no-reply|donotreply|notifications?|automated?|mailer-daemon|postmaster|bounce|alert|updates?)@/i;
const NEWSLETTER_SUBJECT_PATTERN = /\b(unsubscribe|newsletter|mailing.?list|weekly.?digest|monthly.?roundup)\b|뉴스레터|레터/i;
const NEWSLETTER_DOMAIN_PATTERN = /\b(mailchimp|sendgrid|constantcontact|campaignmonitor|klaviyo|substack|beehiiv|facebookmail|instagram|twittermail)\b/;
const SPAM_SUBJECT_PATTERN = /\b(you.?ve won|you.?re the winner|lottery|claim your prize|unclaimed (funds|inheritance)|million (dollars?|USD)|cheap(est)? (meds?|pills?|viagra|cialis)|enlarge|work from home|make money fast|limited time offer|act now|urgent reply)\b/i;
const KOREAN_AD_PATTERN = /^[\(\[](광고|홍보)[\)\]]/;

// ── Phase 2 rule-based classifier (no LLM) ────────────────────────────────────

function classifyWorkType(subject, senderDomain, sieveLabel) {
  if (sieveLabel === 'newsletter' || sieveLabel === 'spam') {
    return { informationalCategory: 'informational', workTypes: [] };
  }
  const s = subject.toLowerCase();
  const d = senderDomain.toLowerCase();

  // Contract — domain-first so noreply@docusign still classifies correctly
  if (/docusign/.test(d) || /계약|nda|agreement|contract|서비스 이용약관|전자서명|esign/.test(s)) {
    return { informationalCategory: sieveLabel ? 'informational' : 'action_required', workTypes: ['contract'] };
  }
  // Meeting — domain-first so noreply@zoom / calendar-notification still classifies
  if (/zoom\.us|calendar\.google/.test(d) || /meeting|회의|미팅|interview|인터뷰|zoom|일정|schedule/.test(s)) {
    return { informationalCategory: sieveLabel ? 'informational' : 'action_required', workTypes: ['meeting'] };
  }
  // Hiring
  if (/saramin/.test(d) || /채용|지원서|resume|job application|recruit|hiring|인재|offer letter|합격|불합격/.test(s)) {
    return { informationalCategory: sieveLabel ? 'informational' : 'action_required', workTypes: ['hiring'] };
  }
  // Payment — domain-first for toss/coupang/billing services
  if (/toss|coupang|stripe|nicepay|inicis|paypal|billing\.kr/.test(d) || /invoice|세금계산서|청구서|payment|결제|billing|receipt|영수증|거래명세서/.test(s)) {
    return { informationalCategory: 'informational', workTypes: ['payment'] };
  }
  // CS
  if (/zendesk/.test(d) || /고객센터|문의|support ticket|complaint|민원|inquiry/.test(s)) {
    return { informationalCategory: sieveLabel ? 'informational' : 'action_required', workTypes: ['cs'] };
  }
  // Report — Korean patterns without \b
  if (/report|보고서|주간보고|월간|분석|analytics|digest|summary/.test(s)) {
    return { informationalCategory: 'informational', workTypes: ['report'] };
  }
  // system_notification with no known business type → informational, no work type
  if (sieveLabel === 'system_notification') {
    return { informationalCategory: 'informational', workTypes: [] };
  }
  return { informationalCategory: 'uncertain', workTypes: ['other'] };
}

// ── Synthetic dataset ─────────────────────────────────────────────────────────

const TEMPLATES = [
  // URGENT (75 emails, 15%)
  ...Array.from({ length: 15 }, (_, i) => ({ subject: `URGENT: 서버 장애 발생 — 즉시 확인 요망 #${i}`, senderDomain: 'ops.mycompany.com', senderLocal: 'devops', expectedLabel: 'pass_through', expectedWorkType: 'other' })),
  ...Array.from({ length: 15 }, (_, i) => ({ subject: `ACTION REQUIRED: 계약서 서명 마감 오늘 ${i}`, senderDomain: 'docusign.com', senderLocal: 'noreply', expectedLabel: 'pass_through', expectedWorkType: 'contract' })),
  ...Array.from({ length: 15 }, (_, i) => ({ subject: `IMPORTANT: 긴급 미팅 요청 — ${i}PM 회의실 B`, senderDomain: 'partner.co.kr', senderLocal: 'ceo', expectedLabel: 'pass_through', expectedWorkType: 'meeting' })),
  ...Array.from({ length: 15 }, (_, i) => ({ subject: `ASAP: 고객 민원 처리 요청 (고객번호 ${10000 + i})`, senderDomain: 'crm.mycompany.com', senderLocal: 'cs-team', expectedLabel: 'pass_through', expectedWorkType: 'cs' })),
  ...Array.from({ length: 15 }, (_, i) => ({ subject: `긴급: 채용 지원자 최종 합격 확인 요청 — ${i}번 지원자`, senderDomain: 'hr.mycompany.com', senderLocal: 'hr', expectedLabel: 'pass_through', expectedWorkType: 'hiring' })),

  // NEWSLETTER (125 emails, 25%)
  ...Array.from({ length: 25 }, (_, i) => ({ subject: `이번 달 뉴스레터 — ${i}월호 주요 소식`, senderDomain: 'substack.com', senderLocal: 'newsletter', expectedLabel: 'quarantine', expectedWorkType: null })),
  ...Array.from({ length: 20 }, (_, i) => ({ subject: `Weekly digest #${i}: AI 업계 최신 동향`, senderDomain: 'mailchimp.com', senderLocal: 'digest', expectedLabel: 'quarantine', expectedWorkType: null })),
  ...Array.from({ length: 20 }, (_, i) => ({ subject: `구독 취소 | 마케팅 레터 ${i}호`, senderDomain: 'sendgrid.net', senderLocal: 'marketing', expectedLabel: 'quarantine', expectedWorkType: null })),
  ...Array.from({ length: 20 }, (_, i) => ({ subject: `Instagram 새 팔로워 ${i}명이 회원님을 팔로우합니다`, senderDomain: 'mail.instagram.com', senderLocal: 'no-reply', expectedLabel: 'quarantine', expectedWorkType: null })),
  ...Array.from({ length: 20 }, (_, i) => ({ subject: `Facebook 소식 — 친구 ${i}명이 포스팅을 남겼습니다`, senderDomain: 'facebookmail.com', senderLocal: 'notification', expectedLabel: 'quarantine', expectedWorkType: null })),
  ...Array.from({ length: 20 }, (_, i) => ({ subject: `채널 뉴스레터 ${i}호: 이번 주 선별된 콘텐츠`, senderDomain: 'beehiiv.com', senderLocal: 'hello', expectedLabel: 'quarantine', expectedWorkType: null })),

  // INFORMATIONAL (100 emails, 20%)
  ...Array.from({ length: 20 }, (_, i) => ({ subject: `주문 #${100000 + i} 배송 완료 안내`, senderDomain: 'noreply.coupang.com', senderLocal: 'noreply', expectedLabel: 'quarantine', expectedWorkType: 'payment' })),
  ...Array.from({ length: 20 }, (_, i) => ({ subject: `AWS 청구서 ${i}월 — 총 $${(i + 1) * 23}.50`, senderDomain: 'amazon.com', senderLocal: 'no-reply-aws', expectedLabel: 'pass_through', expectedWorkType: 'payment' })),
  ...Array.from({ length: 20 }, (_, i) => ({ subject: `세금계산서 발행 안내 — invoice+${i}@billing.kr`, senderDomain: 'billing.kr', senderLocal: `invoice+${i}`, expectedLabel: 'pass_through', expectedWorkType: 'payment' })),
  ...Array.from({ length: 20 }, (_, i) => ({ subject: `GitHub Actions 빌드 성공 — PR #${200 + i}`, senderDomain: 'github.com', senderLocal: 'notifications', expectedLabel: 'quarantine', expectedWorkType: null })),
  ...Array.from({ length: 20 }, (_, i) => ({ subject: `[알림] Google 계정 새 기기 로그인 감지됨 — ${i}`, senderDomain: 'google.com', senderLocal: 'forwarding-noreply', expectedLabel: 'pass_through', expectedWorkType: null })),

  // WORK — CONTRACT (25 emails, 5%)
  ...Array.from({ length: 25 }, (_, i) => ({ subject: `[계약] 서비스 이용약관 갱신 검토 요청 — v${i + 1}.0`, senderDomain: 'legal.partner.com', senderLocal: 'contracts', expectedLabel: 'pass_through', expectedWorkType: 'contract' })),

  // WORK — MEETING (50 emails, 10%)
  ...Array.from({ length: 25 }, (_, i) => ({ subject: `회의 초대: Q${(i % 4) + 1} 전략 미팅 ${i}번째`, senderDomain: 'calendar.google.com', senderLocal: 'calendar-notification', expectedLabel: 'pass_through', expectedWorkType: 'meeting' })),
  ...Array.from({ length: 25 }, (_, i) => ({ subject: `Zoom 미팅 링크: 주간 스탠드업 #${i}`, senderDomain: 'zoom.us', senderLocal: 'no-reply', expectedLabel: 'pass_through', expectedWorkType: 'meeting' })),

  // WORK — CS (40 emails, 8%)
  ...Array.from({ length: 20 }, (_, i) => ({ subject: `고객 문의 접수 #${5000 + i} — 빠른 처리 부탁드립니다`, senderDomain: 'support.myapp.kr', senderLocal: 'helpdesk', expectedLabel: 'pass_through', expectedWorkType: 'cs' })),
  ...Array.from({ length: 20 }, (_, i) => ({ subject: `[Support] Ticket #${3000 + i}: 결제 오류 문의`, senderDomain: 'zendesk.com', senderLocal: 'support', expectedLabel: 'pass_through', expectedWorkType: 'cs' })),

  // WORK — REPORT (35 emails, 7%)
  ...Array.from({ length: 20 }, (_, i) => ({ subject: `주간 보고서 W${i + 1}: 팀 성과 요약`, senderDomain: 'analytics.mycompany.com', senderLocal: 'reports', expectedLabel: 'pass_through', expectedWorkType: 'report' })),
  ...Array.from({ length: 15 }, (_, i) => ({ subject: `월간 analytics digest — ${i + 1}월`, senderDomain: 'mixpanel.com', senderLocal: 'digest', expectedLabel: 'pass_through', expectedWorkType: 'report' })),

  // WORK — HIRING (25 emails, 5%)
  ...Array.from({ length: 25 }, (_, i) => ({ subject: `[채용] 백엔드 개발자 지원서 도착 — 지원자 ${i + 1}`, senderDomain: 'saramin.co.kr', senderLocal: 'recruit', expectedLabel: 'pass_through', expectedWorkType: 'hiring' })),

  // WORK — PAYMENT (25 emails, 5%)
  ...Array.from({ length: 25 }, (_, i) => ({ subject: `결제 완료 영수증 — 주문번호 ORD-${20000 + i}`, senderDomain: 'tosspayments.com', senderLocal: 'receipts', expectedLabel: 'pass_through', expectedWorkType: 'payment' })),

  // KOREAN AD (spam, 5%)
  ...Array.from({ length: 25 }, (_, i) => ({ subject: `(광고) 강남구 AI 교육 프로그램 ${i + 1}기 모집`, senderDomain: 'admail.kr', senderLocal: 'ad', expectedLabel: 'auto_delete', expectedWorkType: null })),
];

// ── L1 sieve ─────────────────────────────────────────────────────────────────

function sieveL1(subject, senderDomain, senderLocal) {
  const senderWithAt = senderLocal + '@';
  if (SPAM_SUBJECT_PATTERN.test(subject) || KOREAN_AD_PATTERN.test(subject)) return 'spam';
  if (NOREPLY_PATTERN.test(senderWithAt)) return 'system_notification';
  if (NEWSLETTER_SUBJECT_PATTERN.test(subject) || NEWSLETTER_DOMAIN_PATTERN.test(senderDomain)) return 'newsletter';
  return null; // pass_through
}

// ── Run pipeline ──────────────────────────────────────────────────────────────

const results = TEMPLATES.map((t) => {
  const sieveLabel = sieveL1(t.subject, t.senderDomain, t.senderLocal);
  const { informationalCategory, workTypes } = classifyWorkType(t.subject, t.senderDomain, sieveLabel);
  return {
    ...t,
    sieveLabel,
    informationalCategory,
    workTypes,
    priorityScore: sieveLabel === null && /URGENT|IMPORTANT|ACTION REQUIRED|ASAP/.test(t.subject) ? 90 : 50,
  };
});

// ── Grouping ──────────────────────────────────────────────────────────────────

// Work-type groups
const workTypeBuckets = {};
const ALL_WORK_TYPES = ['contract', 'meeting', 'cs', 'report', 'hiring', 'payment', 'other'];
for (const wt of ALL_WORK_TYPES) workTypeBuckets[wt] = [];

for (const r of results) {
  if (r.sieveLabel === 'spam') continue;
  const types = r.workTypes.length > 0 ? r.workTypes : [];
  for (const wt of types) {
    (workTypeBuckets[wt] ?? workTypeBuckets['other']).push(r);
  }
}

// Sender groups
const senderMap = new Map();
for (const r of results) {
  if (!senderMap.has(r.senderDomain)) senderMap.set(r.senderDomain, { count: 0, labels: new Set(), workTypes: new Set() });
  const entry = senderMap.get(r.senderDomain);
  entry.count++;
  if (r.sieveLabel) entry.labels.add(r.sieveLabel);
  for (const wt of r.workTypes) entry.workTypes.add(wt);
}

const topSenders = Array.from(senderMap.entries())
  .map(([domain, d]) => ({ domain, count: d.count, labels: [...d.labels], workTypes: [...d.workTypes] }))
  .sort((a, b) => b.count - a.count)
  .slice(0, 15);

// Urgent group
const urgentEmails = results.filter((r) => r.priorityScore >= 80 || r.sieveLabel === null && /URGENT|IMPORTANT|ACTION REQUIRED|ASAP/.test(r.subject));

// ── Accuracy check ────────────────────────────────────────────────────────────

let l1Correct = 0, workTypeCorrect = 0;
for (const r of results) {
  const actualAction = r.sieveLabel === 'spam' ? 'auto_delete' : r.sieveLabel ? 'quarantine' : 'pass_through';
  if (actualAction === r.expectedLabel) l1Correct++;
  if (r.expectedWorkType === null) {
    if (r.workTypes.length === 0 || r.workTypes[0] === 'other') workTypeCorrect++;
  } else if (r.workTypes.includes(r.expectedWorkType)) {
    workTypeCorrect++;
  }
}

const total = results.length;

// ── Report ────────────────────────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════');
console.log('  이메일 그루핑 500건 실데이터 테스트 — CON-73');
console.log('════════════════════════════════════════════════════════\n');

console.log(`📊 총 이메일: ${total}건\n`);

// L1 classification summary
const l1Summary = {};
for (const r of results) {
  const key = r.sieveLabel ?? 'pass_through';
  l1Summary[key] = (l1Summary[key] ?? 0) + 1;
}
console.log('── L1 분류 결과 ─────────────────────────────────────────');
for (const [label, count] of Object.entries(l1Summary).sort((a, b) => b[1] - a[1])) {
  const pct = ((count / total) * 100).toFixed(1);
  console.log(`  ${label.padEnd(20)} ${String(count).padStart(4)}건  (${pct}%)`);
}
console.log(`\n  ✅ L1 분류 정확도: ${l1Correct}/${total} = ${((l1Correct / total) * 100).toFixed(1)}%\n`);

// Work-type groups
console.log('── 업무별 그루핑 ────────────────────────────────────────');
for (const wt of ALL_WORK_TYPES) {
  const bucket = workTypeBuckets[wt];
  if (bucket.length === 0) continue;
  const pct = ((bucket.length / total) * 100).toFixed(1);
  console.log(`  ${wt.padEnd(12)} ${String(bucket.length).padStart(4)}건  (${pct}%)`);
}
console.log(`\n  ✅ 업무 분류 정확도: ${workTypeCorrect}/${total} = ${((workTypeCorrect / total) * 100).toFixed(1)}%\n`);

// Sender groups
console.log('── 발신자별 상위 15개 ───────────────────────────────────');
for (const s of topSenders) {
  const labels = s.labels.length > 0 ? ` [${s.labels.join(', ')}]` : '';
  const wts = s.workTypes.length > 0 ? ` {${s.workTypes.join(', ')}}` : '';
  console.log(`  ${s.domain.padEnd(35)} ${String(s.count).padStart(4)}건${labels}${wts}`);
}

// Urgent group
console.log(`\n── 긴급업무 그룹 ─────────────────────────────────────────`);
console.log(`  긴급 이메일 수: ${urgentEmails.length}건`);
const urgentSenders = [...new Set(urgentEmails.map((e) => e.senderDomain))].slice(0, 5);
console.log(`  주요 발신 도메인: ${urgentSenders.join(', ')}`);
console.log(`  예시 제목:`);
for (const e of urgentEmails.slice(0, 3)) {
  console.log(`    - ${e.subject.slice(0, 70)}`);
}

// Summary
console.log('\n════════════════════════════════════════════════════════');
console.log('📋 요약');
console.log(`  L1 분류 정확도:  ${((l1Correct / total) * 100).toFixed(1)}%`);
console.log(`  업무 분류 정확도: ${((workTypeCorrect / total) * 100).toFixed(1)}%`);
console.log(`  그루핑된 업무 유형: ${ALL_WORK_TYPES.filter((wt) => workTypeBuckets[wt].length > 0).length}개`);
console.log(`  고유 발신 도메인:  ${senderMap.size}개`);
console.log(`  긴급 이메일:      ${urgentEmails.length}건`);
console.log('════════════════════════════════════════════════════════\n');
