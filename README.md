# Backend Senior Portfolio

> 실무 운영 경험(TypeScript/Python) + Java/Kotlin 재설계 + 오픈소스 기여
> 한국 IT 빅테크(네이버, 라인, 카카오, 토스, 쿠팡, 우아한형제들, 당근 등) 백엔드 시니어 포지션 타겟

---

## 이 저장소를 읽는 순서

```
① EXPERIENCE-STORIES.md  ← 먼저 읽기. "이 사람이 실무에서 뭘 했는가"
│    7개 핵심 에피소드: 결제 트랜잭션, 분산 락, 대시보드 최적화, MQ 에러 복구,
│    서킷 브레이커, 2계층 캐시, Akamai 봇 탐지 우회
│    각 에피소드: 문제 → 선택지 → 트레이드오프 → 결정 → 결과 → Java/Spring 대응
│
② STRATEGY-V2.md  ← "어떤 전략으로 준비하고 있는가"
│    10개사 JD 분석, Phase 0~4 실행 로드맵, 회사별 타겟팅
│
③ projects/README.md  ← "코드로 뭘 만들고 있는가"
│    platform-api (Java), platform-event-consumer (Kotlin), async-crawler (Kotlin)
│
④ docs/OPENSOURCE-STRATEGY.md  ← "오픈소스로 어떻게 Java/Kotlin/Spring을 증명하는가"
│    현재 10개 PR 분석 + 타겟 프로젝트별 이슈 + 머지 확률 + 면접 방어
│
⑤ docs/adr/  ← "기술 결정의 근거"
│    ADR-001 Kafka vs RabbitMQ, ADR-002 Coroutines vs VT, ADR-003 Cache
│
⑥ docs/interview-prep/depth-guide.md  ← "면접 꼬리질문 어떻게 방어하는가"
│    9개 영역 × 4단계 깊이 + 실무 연결 + 회사별 맞춤
│
⑦ LEARNING-LOG.md  ← "공부하면서 배운 것 기록"
```

---

## 전체 구조

```
resume/
├── README.md                    ← 지금 읽고 있는 파일. 진입점
│
├── EXPERIENCE-STORIES.md        ← ① 실무 경험 스토리북 (7개 에피소드)
├── STRATEGY-V2.md               ← ② 이직 전략 V2 (10개사 JD + Phase 0~4)
├── STRATEGY.md                  ← (V1 — 아카이브)
├── FEEDBACK.md                  ← 전략 갭 분석 + 개선 포인트
├── LEARNING-LOG.md              ← ⑦ 학습 일지
├── CLAUDE.md                    ← AI 협업 규칙 (이 저장소의 작업 가이드)
│
├── projects/                    ← ③ 포트폴리오 프로젝트
│   ├── README.md                ← 3개 프로젝트 설계 + 언어 선택 근거
│   ├── infra/                   ← 공통 인프라 (docker-compose)
│   │   ├── docker-compose.yml   (Kafka, Redis, MySQL, Prometheus, Grafana, k6)
│   │   ├── k6/load-test.js
│   │   ├── mysql/init.sql
│   │   └── prometheus/prometheus.yml
│   ├── platform-api/            ← (예정) Java + Spring Boot 3.x
│   ├── platform-event-consumer/ ← (예정) Kotlin + Spring Kafka
│   └── async-crawler/           ← (예정) Kotlin Coroutine + Spring Batch
│
└── docs/
    ├── adr/                     ← ⑤ Architecture Decision Records
    │   ├── ADR-001-kafka-vs-rabbitmq.md
    │   ├── ADR-002-coroutines-vs-virtual-threads.md
    │   ├── ADR-003-cache-strategy.md
    │   └── ADR-TEMPLATE.md
    ├── interview-prep/          ← ⑥ 면접 준비
    │   ├── depth-guide.md       ← 꼬리질문 4단계 방어 가이드
    │   └── ADR-001-interview-questions.md
    ├── OPENSOURCE-STRATEGY.md    ← ④ 오픈소스 기여 전략
    └── job-market/              ← JD 분석 자료
```

---

## 실무에서 겪은 문제 → 이 포트폴리오로 재설계

| 실무 문제 | 실무 해결 (Node.js/Python) | 포트폴리오 재설계 (Java/Kotlin) | 에피소드 |
|----------|--------------------------|-------------------------------|---------|
| 결제에서 5개 엔티티 원자적 업데이트 | QueryRunner 수동 트랜잭션 15개 블록 | `@Transactional` + `REQUIRES_NEW` + `TransactionTemplate` | #1 |
| 다중 인스턴스 크론잡 중복 실행 | Redis SET NX + Lua 스크립트 | Redisson `tryLock` + watchdog | #2 |
| 수십만 shop 대시보드 집계 느림 | 사전 계산 테이블 + 복합 인덱스 + 2계층 캐시 | Spring Batch + JPA `@Index` + Caffeine+Redis | #3 |
| 스크래핑 실패 시 무한 재시도 | 4단계 에러 분류 + DLQ 패턴 + 임계값 알림 | Spring Kafka + DLT + `@RetryableTopic` | #4 |
| 외부 플랫폼 차단 폭증 시 IP 블랙리스트 | 적응형 트래픽 제어 (Redis Lua 토큰 버킷) | Resilience4j CircuitBreaker + RateLimiter | #5 |
| 배치 후 캐시 만료 동시 발생 (Stampede) | L1(5분)+L2(24시간) + 분산 락 | Caffeine + Redis + `@Cacheable(sync=true)` | #6 |
| Akamai 봇 탐지로 95% 차단 | Camoufox + TLS 핑거프린트 우회 + 좀비 프로세스 관리 | Resilience4j + SmartLifecycle + 리소스 풀 패턴 | #7 |

---

## 시스템 아키텍처

```
                         [platform-api] ★ Java 17+
                         ┌────────────────────────────────────────┐
   사용자 요청 ─────────▶│  Spring Boot 3.x + Java                │
                         │                                        │
                         │  결제: @Transactional + @Version        │
                         │  분산락: Redisson                       │
                         │  캐시: Caffeine(L1) + Redis(L2)        │
                         │  장애격리: Resilience4j CircuitBreaker  │
                         │  이벤트: Transactional Outbox           │
                         └──────────┬─────────────────────────────┘
                                    │ Kafka
                                    ▼
                         [platform-event-consumer] ★ Kotlin
                         ┌────────────────────────────────────────┐
                         │  Spring Kafka + Kotlin Coroutine       │
                         │                                        │
                         │  멱등: Idempotent Consumer              │
                         │  에러: Dead Letter Topic                │
                         │  모니터링: Prometheus + Grafana          │
                         └────────────────────────────────────────┘

  [async-crawler] ★ Kotlin ────────────────▶ platform-api
   Coroutine + Spring Batch
   서킷 브레이커 + Rate Limiting
```

**왜 Java + Kotlin 혼합?** → [projects/README.md](projects/README.md#왜-java--kotlin-혼합인가-면접-방어)에서 상세 설명

---

## 오픈소스 기여 현황

**외부 오픈소스 머지된 PR: 10개** (2026-04-06 기준)

| 프로젝트 | PR 수 | 대표 기여 | 난이도 |
|---------|:---:|----------|:---:|
| **kotest/kotest** | 6 | type-safe assertion (@OnlyInputTypes), Native IR 크래시 수정, JsonSchema anyOf/oneOf DSL | Hard×3 |
| **sksamuel/hoplite** | 1 | strict mode prefix 버그 수정 | Medium |
| **spring-cloud/spring-cloud-gateway** | 1 | DCO 문서 업데이트 | Docs |
| **testcontainers/testcontainers-java** | 1 | k6 문서 개선 | Docs |
| **taskforcesh/bullmq** | 1 | sandboxed processor IPC 프록시 (v5.73.0 릴리스) | Medium |

**다음 타겟:** Resilience4j (서킷 브레이커), Spring Kafka, Armeria (LINE 오픈소스)
→ 상세: [docs/OPENSOURCE-STRATEGY.md](docs/OPENSOURCE-STRATEGY.md)

---

## ADR (Architecture Decision Records)

| ADR | 주제 | 결정 | 면접 연결 |
|-----|------|------|----------|
| [ADR-001](docs/adr/ADR-001-kafka-vs-rabbitmq.md) | 메시지 브로커 | Kafka (재처리, Consumer Group, 파티션 순서) | Episode #4 |
| [ADR-002](docs/adr/ADR-002-coroutines-vs-virtual-threads.md) | 비동기 처리 | Kotlin Coroutines (Structured Concurrency) | Episode #5, #7 |
| [ADR-003](docs/adr/ADR-003-cache-strategy.md) | 캐시 전략 | Cache-Aside + 분산 락 (Stampede 방지) | Episode #6 |
| ADR-004 (예정) | 분산 락 구현 | Redisson vs SET NX+Lua | Episode #2 |
| ADR-005 (예정) | Outbox Relay 주기 | 폴링 vs CDC | Episode #4 |

---

## 면접 준비

### 꼬리질문 4단계 방어

[docs/interview-prep/depth-guide.md](docs/interview-prep/depth-guide.md)에서 9개 기술 영역별로:

```
[1단계] 기본 답변 — 이것만 답하면 주니어
[2단계] 원리 설명 — 3년차 합격선
[3단계] 트레이드오프 — 5년차 시니어
[4단계] 실무 적용 — "현업에서 고민해보지 않으면 답 못할"
```

### 회사별 타겟팅

| 회사 | 핵심 준비 | 어필 에피소드 |
|------|----------|-------------|
| 토스/카카오페이 | Kotlin Coroutine + 결제 멱등성 + 테스트 | #1, #5 |
| 우아한형제들 | DDD + Spring Batch + 대용량 배치 | #3, #4 |
| 라인 | JVM 심화 + 분산 시스템 + Armeria | #2, #5, #7 |
| 쿠팡 | 시스템 디자인 + DB 샤딩 + Bar Raiser | #3, #7 |
| 네이버 | CS 기초 원리 + JVM + 대규모 트래픽 | #2, #3, #6 |
| 당근 | Kotlin + 실용주의 설계 + 컬쳐핏 | #1, #5 |

상세: [STRATEGY-V2.md](STRATEGY-V2.md)

---

## 로컬 개발 환경

```bash
cd projects/infra
docker-compose up -d

# Kafka UI:   http://localhost:8989
# Grafana:    http://localhost:3000 (admin/admin)
# Prometheus: http://localhost:9090
```

부하테스트:
```bash
docker-compose --profile loadtest run --rm k6 run /scripts/load-test.js
```

---

## 설계 원칙

**1. AI를 도구로, 판단은 내가**
```
문제 정의 (내가) → 대안 탐색 (AI + 공식 문서) → 트레이드오프 분석 (내가)
→ 결정 + ADR 작성 → 구현 (AI 보조) → 검증 + 측정 (내가)
```

**2. 실제 문제 기반 설계** — 토이 프로젝트처럼 보이지 않으려면, 해결하는 문제가 실제여야 함

**3. 측정 가능한 수치만 어필**
```
❌ "고성능 시스템"    ✅ "k6 기준 캐시 히트율 80% 조건에서 8,500 TPS, P99 15ms"
```

**4. 회사 코드 노출 금지** — 실제 코드는 절대 포함하지 않음. 문제 패턴만 재설계

---

## 진행 상태

| 항목 | 상태 |
|------|------|
| 실무 스토리 7개 정리 (EXPERIENCE-STORIES.md) | ✅ 완료 |
| 이직 전략 V2 (STRATEGY-V2.md) | ✅ 완료 |
| 오픈소스 전략 (OPENSOURCE-STRATEGY.md) | ✅ 완료 |
| 면접 깊이 가이드 (depth-guide.md) | ✅ 완료 |
| ADR 3개 (Kafka, Coroutine, Cache) | ✅ 완료 |
| ADR-001 면접 Q&A | ✅ 완료 |
| 프로젝트 설계 리팩토링 (Java+Kotlin) | ✅ 완료 |
| docker-compose 인프라 | ✅ 완료 |
| k6 부하 테스트 스크립트 | ✅ 완료 |
| **platform-api 스켈레톤 (Java)** | 🔜 Phase 0 |
| **platform-event-consumer (Kotlin)** | 🔜 Phase 1 |
| **async-crawler (Kotlin)** | 🔜 Phase 2 |
| **Resilience4j PR** | 🔜 Phase 2 |
| k6 실측 수치 | 🔜 Phase 2 |
| Grafana 대시보드 스크린샷 | 🔜 Phase 3 |

---

## 연락처

- GitHub: [@PreAgile](https://github.com/PreAgile)
