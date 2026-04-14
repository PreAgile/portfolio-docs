# MSA 서비스 경계 설계

> **현재 상태 (Phase 0)**: 단일 Spring Boot 모놀리스로 시작.
> 이 문서는 "어떤 문제가 생기면 어디서 분리할 것인가"의 설계 후보안이다.
> 실제 분리는 k6 부하테스트로 병목을 측정한 뒤 결정한다.
>
> **목적**: 분리 기준을 Business Capability로 정의하여
> "언어가 달라서 분리"가 아니라 "장애 특성과 스케일 요구가 달라서 분리"임을 명시한다.
>
> **작성일**: 2026-04-11

---

## Phase 0: 모놀리스에서 시작하는 이유

```
[Martin Fowler, "Monolith First"]
"분산 시스템의 첫 버전을 마이크로서비스로 시작하지 마라.
경계가 명확해졌을 때 분리하라."
```

**모놀리스 단계에서 하나의 platform-api에 포함되는 것:**
- 결제 / 구독 처리
- 크롤링 스케줄러 (외부 플랫폼 호출)
- 대시보드 집계 + 조회

**분리 기준이 되는 측정 항목 (k6로 재현할 것):**

| 측정 항목 | 분리 기준 |
|---------|---------|
| 크롤러 부하 시 결제 P99 | 정상 P99의 3배 이상 → 장애 격리 필요 |
| DB 커넥션 대기 시간 | 결제가 크롤러 때문에 커넥션 대기 → 분리 필요 |
| 서비스 중단 없는 크롤러 배포 | 불가능한 시점 → 배포 독립성 필요 |

**이 수치가 측정되기 전까지는 모놀리스 유지가 올바른 결정이다.**

---

## 서비스 경계 맵

아래는 모놀리스에서 병목이 확인된 이후 분리할 구조다.

```
┌─────────────────────────────────────────────────────────────────────┐
│                           서비스 경계                                 │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │               platform-api (Java)                              │  │
│  │  Business Capability: 비즈니스 핵심 로직                        │  │
│  │                                                                │  │
│  │  - 결제/구독 처리 (외부 PG 연동)                                │  │
│  │  - 고객/매장 관리                                               │  │
│  │  - 대시보드 읽기 API                                            │  │
│  │  - Transactional Outbox 발행                                   │  │
│  └──────────────────────┬─────────────────────────────────────────┘  │
│                          │ Kafka (Domain Events)                      │
│          ┌───────────────┼────────────────────┐                      │
│          ▼               ▼                    ▼                      │
│  ┌───────────────┐  ┌────────────────────────────────────────────┐   │
│  │  async-crawler│  │      platform-event-consumer (Kotlin)      │   │
│  │  (Kotlin)     │  │  Business Capability: 이벤트 처리          │   │
│  │               │  │                                            │   │
│  │  Business     │  │  - Dashboard 집계 갱신                     │   │
│  │  Capability:  │  │  - 알림 발송                               │   │
│  │  데이터 수집  │  │  - Subscription 상태 갱신                  │   │
│  │               │  │  - Dead Letter 재처리                      │   │
│  │  - 6개 외부   │  └────────────────────────────────────────────┘   │
│  │    플랫폼     │                                                    │
│  │    크롤링     │                                                    │
│  │  - 장애 격리  │                                                    │
│  │  - Rate Limit │                                                    │
│  └───────┬───────┘                                                    │
│          │ REST (수집 결과 → platform-api)                            │
│          └──────────────────────────────────────────────────────────  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 서비스별 분리 근거

### 1. platform-api — "비즈니스 핵심 로직"

**분리 기준**: 금전 트랜잭션 + 데이터 정합성

| 항목 | 상세 |
|------|------|
| 핵심 책임 | 결제, 구독, 고객 관리 — 실패 시 직접 금전 손실 |
| 기술 선택 | Java: 성숙한 트랜잭션 생태계 (`@Transactional`, JPA) |
| 확장 방향 | 수직 확장 위주 (결제는 상태 공유 복잡도 높음) |
| 장애 허용 | 불가 — SLA 99.9% 이상 요구 |
| 다른 서비스와 결합 | Kafka를 통한 이벤트 발행만. 직접 DB 접근 없음 |

**왜 Event Consumer와 분리?**
- 결제 처리와 집계 처리의 장애를 격리
- Consumer 장애 시 결제 API는 정상 운영
- Consumer Lag이 쌓여도 결제 응답 시간에 영향 없음

**왜 Crawler와 분리?**
- Crawler는 외부 플랫폼 차단 시 CPU/메모리 폭증 가능
- 같은 JVM이면 결제 API 응답 시간 직접 영향
- Crawler는 수평 확장(100+ 인스턴스), API는 소수(5~10)

---

### 2. platform-event-consumer — "이벤트 기반 집계"

**분리 기준**: 이벤트 처리 처리량 + Kafka Consumer Group 독립성

| 항목 | 상세 |
|------|------|
| 핵심 책임 | Kafka 이벤트 소비 → DB 집계 갱신 → 캐시 무효화 |
| 기술 선택 | Kotlin Coroutine: 높은 처리량, 비동기 DB 접근 자연스러움 |
| 확장 방향 | 수평 확장 (파티션 수 = Consumer 인스턴스 수) |
| 장애 허용 | 지연 허용 — Consumer Lag은 쌓일 수 있지만 재처리 가능 |
| 다른 서비스와 결합 | Kafka에서만 메시지 수신. platform-api DB에 직접 쓰지 않음 |

**Consumer Group 독립성의 의미**

```
payment-events (Kafka Topic)
├── consumer-group: dashboard-aggregate  → platform-event-consumer
├── consumer-group: notification-service → (미래 서비스)
└── consumer-group: audit-log           → (미래 서비스)
```

- 하나의 이벤트를 여러 서비스가 **독립적으로** 소비
- 새 서비스가 추가되어도 기존 Consumer에 영향 없음
- RabbitMQ였다면: 동일 큐를 여러 Consumer가 경쟁 → 메시지 중복 처리 문제

---

### 3. async-crawler — "외부 의존성 관리"

**분리 기준**: 외부 시스템 의존성 + 불안정성 격리

| 항목 | 상세 |
|------|------|
| 핵심 책임 | 6개 외부 플랫폼 데이터 수집 + 장애 격리 |
| 기술 선택 | Kotlin Coroutine: 수백 개 동시 HTTP 요청 처리 |
| 확장 방향 | 플랫폼별 독립 스케일링 (A 플랫폼 장애 시 A만 스케일 다운) |
| 장애 허용 | 높음 — 외부 플랫폼 장애 시 재시도 + 서킷 브레이커 |
| 다른 서비스와 결합 | platform-api에 수집 결과 REST 전달 |

**왜 Kafka 이벤트로 결과를 보내지 않고 REST로?**
- 수집 결과는 즉시 저장이 필요 (지연 시 데이터 유실 가능)
- platform-api의 응답 코드를 크롤러가 알아야 함 (저장 실패 → 재시도)
- Kafka의 At-least-once 보장으로는 재시도 시점 제어가 어려움
- 트레이드오프: 결합도 증가 vs 데이터 유실 리스크 → **데이터 유실 리스크 제거를 선택** (결합도 증가 감수)

---

## 서비스 간 통신 패턴

### 동기 통신 (REST): async-crawler → platform-api

```
async-crawler
    │
    │ POST /api/v1/collections   (수집 결과 저장)
    ▼
platform-api
    │
    │ 200 OK (저장 성공) / 4xx (클라이언트 에러) / 5xx (서버 에러)
    ▼
async-crawler
    │
    ├── 200: 성공, 다음 작업
    ├── 429: Rate Limit → 지수 백오프 후 재시도
    ├── 500: platform-api 오류 → Circuit Breaker 카운트 증가
    └── Connection Timeout → Circuit Breaker 카운트 증가
```

### 비동기 통신 (Kafka): platform-api → platform-event-consumer

```
platform-api
    │
    │ INSERT INTO outbox_events (Transactional Outbox)
    │
    │ [Outbox Relay 스케줄러 — 5초마다]
    │ SELECT FOR UPDATE SKIP LOCKED
    ▼
Kafka (payment-events topic)
    │
    │ Consumer Group: dashboard-aggregate
    ▼
platform-event-consumer
    │
    │ 처리 성공 → Manual Commit
    │ 처리 실패 → Dead Letter Topic (최대 3회 재시도 후)
    ▼
DLT 처리 서비스
    │ 운영자 알림 + 수동 재처리 대기
```

---

## 서비스 경계 검증 질문

서비스 분리 시 스스로 검증하는 질문:

1. **장애 격리**: A 서비스 장애가 B 서비스에 영향을 주는가?
   - Crawler 장애 → API 영향 없어야 함 ✅
   - Consumer Lag → API 응답 영향 없어야 함 ✅

2. **독립 배포**: A 배포 시 B도 배포해야 하는가?
   - Crawler 배포 → API 재시작 불필요 ✅
   - Consumer 배포 → Kafka에서 오프셋 유지 → 무중단 ✅

3. **독립 스케일링**: A와 B의 스케일링 기준이 다른가?
   - Crawler: 외부 API Rate Limit 기준
   - Consumer: Kafka Lag 기준
   - API: 요청 TPS 기준 ✅

4. **데이터 소유권**: A가 B의 DB를 직접 읽거나 쓰는가?
   - 모든 서비스가 자체 DB 스키마 소유 ✅
   - 이벤트를 통해서만 타 서비스 상태 변경 ✅

---

## 분리하지 않은 것 — 의도적 결정

### 알림(Notification)을 별도 서비스로 분리하지 않은 이유

- 현재 알림 볼륨: 낮음 (운영 이벤트 중심)
- 분리 비용 > 이득 구간
- 분리 기준: "알림 서비스가 독립적으로 장애나도 결제/집계는 정상이어야 한다"
  → 현재는 Consumer 내부에서 처리해도 충분
- 재검토 기준: 알림 볼륨이 Consumer 처리량의 30% 초과 시

### 인증(Auth)을 별도 서비스로 분리하지 않은 이유

- JWT 기반 Stateless 인증 → platform-api에서 검증
- API Gateway에서 처리하는 것이 더 자연스러운 패턴
- 분리 기준: 멀티 테넌트 SSO, OAuth2 Provider 기능 추가 시
