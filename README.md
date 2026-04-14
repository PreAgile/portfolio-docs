# Backend Senior Portfolio

> 실무 운영 경험(TypeScript/Python) + Java/Kotlin 재설계 + 오픈소스 기여
> 한국 IT 빅테크(네이버, 라인, 카카오, 토스, 쿠팡, 우아한형제들, 당근 등) 백엔드 시니어 포지션 타겟

---

## 이 저장소의 핵심

**"이 기술을 써봤다"가 아니라 "이 문제를 직접 겪어보고, 원리를 파고, 해결한 근거가 있다"**

6개 Deep Dive Track으로 구성. 각 트랙은 **"당해보기 → 측정 → 딥다이브 → 해결 → 증거 → 스토리"** 순서를 따른다.

---

## 읽는 순서

```
① STRATEGY.md          ← 왜, 어떻게. 6개 Deep Dive Track 전략
② LEARNING-LOG.md      ← 실험 증거. 가설 → 실험 → 결과 → 발견
③ docs/adr/            ← 기술 결정 근거 (Kafka, Cache, 분산 락, Outbox)
```

실무 경험과 면접 준비가 궁금하면:
- [EXPERIENCE-STORIES.md](EXPERIENCE-STORIES.md) — 실무 7개 에피소드
- [docs/interview-prep/depth-guide.md](docs/interview-prep/depth-guide.md) — 꼬리질문 4단계 방어

---

## Deep Dive Tracks — 진행 상태

| Track | 주제 | 핵심 실험 | 상태 |
|:-----:|------|---------|:----:|
| 0 | 측정 기반 구축 | docker-compose + k6 + Grafana 기준선 측정 | 🔜 |
| 1 | 동시성 & 분산 락 | 락 없이 100스레드 → 데이터 불일치 실측 → Redisson | 🔜 |
| 2 | Kafka & 메시지 안정성 | auto-commit + kill → 유실 재현 → Idempotent Consumer | 🔜 |
| 3 | 캐시 & Stampede | TTL 만료 시 Stampede 재현 → L1+L2+분산 락 | 🔜 |
| 4 | 장애 격리 & 복원력 | CB 없이 외부 장애 전파 → Resilience4j | 🔜 |
| 5 | 이벤트 드리븐 & Outbox | 직접 발행 → 크래시 시 유실 → Outbox Pattern | 🔜 |

각 트랙 상세: [STRATEGY.md](STRATEGY.md)

---

## 서비스 컨텍스트

6개 외부 플랫폼의 리뷰/주문/매출 데이터를 실시간 수집하여 기업 고객에게 대시보드로 제공하는 **B2B SaaS**.
메인 담당: **대규모 외부 데이터 수집 파이프라인의 분산 아키텍처 설계/운영** + 결제/구독 + 대용량 집계.

## 실무에서 겪은 문제 → 이 포트폴리오로 재설계

| 실무 문제 | Deep Dive Track | 포트폴리오 재설계 |
|----------|:--------------:|----------------|
| 토큰 덮어쓰기 동시성 버그 | Track 1 | Redisson 분산 락 + 락 방식별 실측 비교 |
| 메시지 유실 + 중복 처리 | Track 2 | Manual Commit + Idempotent Consumer |
| 배치 후 캐시 동시 만료 | Track 3 | L1(Caffeine) + L2(Redis) + Stampede 방지 |
| 외부 API 장애 → 연쇄 실패 | Track 4 | Resilience4j Circuit Breaker |
| DB 저장 후 이벤트 유실 | Track 5 | Transactional Outbox Pattern |

---

## 시스템 아키텍처

```
                         [platform-api] ★ Java 17+
                         ┌────────────────────────────────────────┐
   사용자 요청 ─────────▶│  Spring Boot 3.x + Java                │
                         │                                        │
                         │  Track 1: Redisson 분산 락              │
                         │  Track 3: Caffeine(L1) + Redis(L2)     │
                         │  Track 4: Resilience4j CircuitBreaker  │
                         │  Track 5: Transactional Outbox          │
                         └──────────┬─────────────────────────────┘
                                    │ Kafka (Outbox Relay)
                                    ▼
                         [platform-event-consumer] ★ Kotlin
                         ┌────────────────────────────────────────┐
                         │  Spring Kafka + Kotlin Coroutine       │
                         │                                        │
                         │  Track 2: Manual Commit + Idempotent   │
                         │  Track 2: Dead Letter Topic            │
                         │  Track 0: Prometheus + Grafana          │
                         └────────────────────────────────────────┘

  [async-crawler] ★ Kotlin ────────────────▶ platform-api
   Track 4: Coroutine + CircuitBreaker + Rate Limiting
```

프로젝트 상세: [projects/README.md](projects/README.md)

---

## 오픈소스 기여 현황

**외부 오픈소스 머지된 PR: 10개** (2026-04-06 기준)

| 프로젝트 | PR 수 | 대표 기여 | 난이도 |
|---------|:---:|----------|:---:|
| **kotest/kotest** | 6 | type-safe assertion, Native IR 크래시 수정, JsonSchema DSL | Hard x3 |
| **sksamuel/hoplite** | 1 | strict mode prefix 버그 수정 | Medium |
| **spring-cloud/spring-cloud-gateway** | 1 | DCO 문서 업데이트 | Docs |
| **testcontainers/testcontainers-java** | 1 | k6 문서 개선 | Docs |
| **taskforcesh/bullmq** | 1 | sandboxed processor IPC 프록시 (v5.73.0) | Medium |

상세: [docs/OPENSOURCE-STRATEGY.md](docs/OPENSOURCE-STRATEGY.md)

---

## ADR (Architecture Decision Records)

| ADR | 주제 | 결정 | Track |
|-----|------|------|:-----:|
| [ADR-001](docs/adr/ADR-001-kafka-vs-rabbitmq.md) | 메시지 브로커 | Kafka | 2 |
| [ADR-002](docs/adr/ADR-002-coroutines-vs-virtual-threads.md) | 비동기 처리 | Kotlin Coroutines | 2, 4 |
| [ADR-003](docs/adr/ADR-003-cache-strategy.md) | 캐시 전략 | Cache-Aside + 분산 락 | 3 |
| [ADR-004](docs/adr/ADR-004-distributed-lock.md) | 분산 락 구현 | Redisson | 1 |
| [ADR-005](docs/adr/ADR-005-outbox-relay.md) | Outbox Relay | 폴링 5초 | 5 |

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

## 참고 문서

| 문서 | 설명 |
|------|------|
| [STRATEGY-V2.md](STRATEGY-V2.md) | 10개사 JD 분석 + 기술 블로그 깊이 분석 (아카이브) |
| [EXPERIENCE-STORIES.md](EXPERIENCE-STORIES.md) | 실무 경험 7개 에피소드 |
| [docs/interview-prep/depth-guide.md](docs/interview-prep/depth-guide.md) | 꼬리질문 4단계 방어 (9개 영역) |
| [docs/ddd/DOMAIN-MODEL.md](docs/ddd/DOMAIN-MODEL.md) | Bounded Context + Aggregate 설계 |
| [docs/architecture/MSA-BOUNDARY.md](docs/architecture/MSA-BOUNDARY.md) | 서비스 분리 근거 |
| [docs/ai/AI-DESIGN-LOG.md](docs/ai/AI-DESIGN-LOG.md) | AI 설계 협업 기록 |
| [docs/testing/TDD-CASES.md](docs/testing/TDD-CASES.md) | TDD 케이스 가이드 |
| [FEEDBACK.md](FEEDBACK.md) | 초기 전략 갭 분석 (아카이브) |

---

## 설계 원칙

**1. 당해보기 → 측정 → 딥다이브 → 해결 → 증거 → 스토리**
기술을 먼저 도입하지 않는다. 기술이 없을 때의 문제를 먼저 체감하고, Before/After 수치로 증명한다.

**2. AI를 도구로, 판단은 내가**
문제 정의와 트레이드오프 판단은 내가. 대안 탐색과 구현 보조는 AI.

**3. 측정 가능한 수치만 어필**
```
❌ "고성능 시스템"    ✅ "k6 기준 캐시 히트율 80% 조건에서 8,500 TPS, P99 15ms"
```

**4. 회사 코드 노출 금지** — 실제 코드는 절대 포함하지 않음. 문제 패턴만 재설계.

---

## 연락처

- GitHub: [@PreAgile](https://github.com/PreAgile)
