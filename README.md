# portfolio-docs

> **백엔드 포트폴리오 설계 문서 허브**
>
> 실제 운영 경험(TypeScript/Python)을 Java/Kotlin 기반으로 재설계하는 과정에서
> 내린 모든 기술 결정과 그 근거를 기록한 저장소입니다.

---

## 왜 이 저장소가 존재하는가

회사에서 운영 중인 시스템(메시지큐, 스크레이퍼, API 서버)을 통해 다음과 같은 실제 문제들을 경험했습니다.

| 실제 이슈 | 증상 | 재현할 기술 해결책 |
|---------|------|----------------|
| 메시지 처리 중 Consumer 재시작 시 데이터 유실 | 플랫폼 로그 잘림, 데이터 누락 | Kafka + Transactional Outbox Pattern |
| 동시 요청에서 토큰 값이 덮어씌워지는 버그 | 인증 오류, 세션 혼재 | Redis 분산락 (Redisson) |
| 동일 메시지 중복 처리로 DB 데이터 중복 | 중복 리뷰 저장 | Idempotent Consumer |
| soft-delete 조건 필터 누락 | 비활성 가게 데이터 노출 | DDD + 도메인 레이어 분리 |
| 외부 크롤링 API 장애 시 전체 서비스 응답 지연 | 연쇄 장애 | Circuit Breaker + Fallback |

회사 코드는 공개할 수 없습니다. 이 저장소는 **문제 패턴을 재설계한 포트폴리오**의 설계 문서이며, 각 구현 저장소와 연결됩니다.

---

## 포트폴리오 구성

### 코드 저장소 (구현)

| 저장소 | 핵심 기술 | 어필 포인트 |
|-------|---------|-----------|
| [platform-api](https://github.com/PreAgile/platform-api) | Spring Boot 3.x + Kotlin | Outbox Pattern, 분산락, Circuit Breaker, Saga |
| [platform-event-consumer](https://github.com/PreAgile/platform-event-consumer) | Spring Kafka + Kotlin | Idempotent Consumer, DLT, Consumer Lag 모니터링 |
| [async-crawler](https://github.com/PreAgile/async-crawler) | Kotlin Coroutines + Spring Batch | Bloom Filter, Rate Limiting, 비동기 HTTP |

### 이 저장소 (설계 문서)

```
portfolio-docs/
├── README.md               ← 지금 읽고 있는 파일. 전체 포트폴리오 진입점
├── STRATEGY.md             ← 포트폴리오 전체 전략, 프로젝트 설계 원칙, 로드맵
├── FEEDBACK.md             ← 전략 갭 분석 및 개선 포인트 (자기 리뷰)
├── LEARNING-LOG.md         ← 구현하면서 배운 것들 기록 (블로그 초안)
├── docs/
│   └── adr/                ← Architecture Decision Records
│       ├── ADR-001-kafka-vs-rabbitmq.md
│       ├── ADR-002-coroutines-vs-virtual-threads.md
│       ├── ADR-003-cache-strategy.md
│       └── ADR-TEMPLATE.md
└── projects/
    └── infra/              ← 로컬 개발 공통 인프라
        ├── docker-compose.yml  (Kafka, Redis, MySQL, Prometheus, Grafana, k6)
        ├── k6/load-test.js
        ├── mysql/init.sql
        └── prometheus/prometheus.yml
```

---

## 시스템 아키텍처

```
사용자 요청
    │
    ▼
[platform-api]
 Spring Boot 3.x + Kotlin
 - 가게/리뷰 도메인 API
 - Transactional Outbox Pattern     ─── 같은 트랜잭션에서 DB 저장 + Outbox 이벤트 저장
 - Redis 분산락 (Redisson)          ─── 동시 요청에서 공유 자원 보호
 - Circuit Breaker (Resilience4j)  ─── 외부 크롤링 API 장애 격리
 - Choreography Saga               ─── 분산 트랜잭션 (보상 흐름)
    │
    │ Kafka (Outbox Relay가 폴링 → 발행)
    ▼
[platform-event-consumer]
 Spring Kafka + Kotlin
 - Idempotent Consumer             ─── processed_events 테이블로 중복 처리 방지
 - Dead Letter Topic               ─── 실패 메시지 재처리
 - Consumer Lag 모니터링           ─── Micrometer → Prometheus → Grafana

[async-crawler]
 Kotlin Coroutines + Spring Batch
 - Redis Bloom Filter              ─── 중복 URL 메모리 효율적 체크
 - Bucket4j Rate Limiting          ─── IP 차단 방지
 - Spring Batch Chunk 처리         ─── 대량 크롤링 재시도 전략
    │
    └── platform-api로 크롤링 결과 전달 (HTTP or Kafka)
```

---

## ADR (Architecture Decision Records)

모든 중요한 기술 결정은 ADR로 문서화합니다.
각 ADR에는 검토한 대안, AI와 함께 검증한 내용, 최종 결정 근거가 포함됩니다.

| ADR | 주제 | 결정 |
|-----|------|------|
| [ADR-001](docs/adr/ADR-001-kafka-vs-rabbitmq.md) | 메시지 브로커 선택 | Kafka 선택 (재처리 요구사항, Consumer Group) |
| [ADR-002](docs/adr/ADR-002-coroutines-vs-virtual-threads.md) | 비동기 처리 방식 | Kotlin Coroutines (Structured Concurrency, Flow API) |
| [ADR-003](docs/adr/ADR-003-cache-strategy.md) | 캐시 전략 | Cache-Aside + Redis 분산락 (Stampede 방지) |
| ADR-004 (예정) | Idempotent Consumer 구현 방식 | - |
| ADR-005 (예정) | Outbox Relay 폴링 주기 결정 | - |

---

## 로컬 개발 환경 실행

```bash
cd projects/infra
docker-compose up -d

# 서비스 접속
# Kafka UI:   http://localhost:8989
# Grafana:    http://localhost:3000  (admin / admin)
# Prometheus: http://localhost:9090
```

부하테스트 실행:
```bash
docker-compose --profile loadtest run --rm k6 run /scripts/load-test.js
```

---

## 설계 원칙

### 1. AI를 도구로, 판단은 내가

```
문제 정의 → 대안 탐색 (AI + 공식 문서) → 트레이드오프 분석 (내가)
→ 결정 + ADR 작성 → 구현 (AI 보조) → 검증 + 측정
```

### 2. 실제 문제 기반 설계

토이 프로젝트처럼 보이지 않으려면, 해결하는 문제가 실제여야 합니다.
각 구현은 실제 운영에서 겪은 문제 패턴에서 출발합니다.

### 3. 측정 가능한 수치만 어필

```
❌ "고성능 시스템"  ✅ "k6 기준 캐시 히트율 80% 조건에서 8,500 TPS, P99 15ms"
❌ "대용량 처리"    ✅ "Consumer Lag 기준 알람 임계값 10,000건, 실측 처리 속도 X msg/s"
```

---

## 학습 로드맵

| Phase | 내용 | 상태 |
|-------|------|------|
| Phase 1 | Spring 내부 동작, @Transactional, JPA, Kotlin Coroutines 기초 | 진행 중 |
| Phase 2 | Kafka 심화 (Rebalancing, Offset 관리), Testcontainers 통합 테스트 | 예정 |
| Phase 3 | 3개 서비스 구현 + k6 부하테스트 | 예정 |
| Phase 4 | GitHub Actions CI, 문서화 완성 | 예정 |

학습 과정은 [LEARNING-LOG.md](LEARNING-LOG.md)에 기록합니다.

---

## 연락처

- GitHub: [@PreAgile](https://github.com/PreAgile)
