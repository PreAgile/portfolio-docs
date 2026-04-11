# DDD 도메인 모델

> **목적**: B2B SaaS 플랫폼의 비즈니스 도메인을 Bounded Context로 분리하고,
> 각 Context의 Aggregate, Value Object, Domain Event를 정의한다.
> 이 문서는 platform-api(Java) 설계의 근거가 된다.
>
> **작성일**: 2026-04-11

---

## 서비스 컨텍스트 요약

6개 외부 플랫폼(배달, 커머스 등)의 리뷰/주문/매출 데이터를 수집하여
기업 고객에게 통합 대시보드로 제공하는 B2B SaaS.

---

## Bounded Context 맵

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Context Map                                    │
│                                                                       │
│  ┌──────────────┐   Shared Kernel    ┌──────────────────────────┐   │
│  │   Payment BC │◀──────────────────▶│     Subscription BC      │   │
│  │              │                    │                          │   │
│  │  결제/환불    │   Customer/PlanId  │  구독 플랜 / 청구 주기    │   │
│  └──────┬───────┘                    └──────────┬───────────────┘   │
│         │ Domain Event (PaymentCompleted)        │                   │
│         ▼ Anti-Corruption Layer                  │                   │
│  ┌──────────────┐                    ┌──────────▼───────────────┐   │
│  │  Dashboard BC│                    │     Collection BC         │   │
│  │              │◀───────────────────│                          │   │
│  │  집계 / 조회  │  Collected Data    │  외부 플랫폼 수집 / 파싱  │   │
│  └──────────────┘                    └──────────────────────────┘   │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

### Context 간 관계 설명

| 관계 | 설명 |
|------|------|
| Payment ↔ Subscription (Shared Kernel) | `CustomerId`, `PlanId` 공유. 변경 시 양쪽 합의 필요 |
| Payment → Dashboard (Customer/Supplier) | Payment가 이벤트 발행. Dashboard는 수신만 |
| Collection → Dashboard (Customer/Supplier) | Collection이 수집 결과 발행. Dashboard가 소비 |
| Subscription → Collection (ACL) | Collection이 Subscription 상태를 번역 계층으로 조회 |

---

## Payment Bounded Context

### Aggregate: Payment

```
Payment (Aggregate Root)
├── id: PaymentId                    ← Value Object
├── customerId: CustomerId           ← Value Object (다른 BC의 식별자)
├── amount: Money                    ← Value Object (금액 + 통화)
├── status: PaymentStatus            ← Enum (PENDING → COMPLETED / FAILED / REFUNDED)
├── idempotencyKey: IdempotencyKey   ← Value Object (중복 결제 방지)
├── method: PaymentMethod            ← Value Object (카드 정보)
├── couponApplied: Coupon            ← Entity (쿠폰 적용 내역)
└── webhookEvents: List<WebhookEvent> ← Entity (PG사 웹훅 기록)
```

**왜 Coupon을 별도 Entity로?**
- 쿠폰은 결제와 생명주기가 다르다 (쿠폰 정책 변경 시 기존 결제에 영향 없음)
- Aggregate 경계: Payment가 Coupon을 소유하지만, Coupon의 정책(할인율)은 외부 Coupon BC에서 관리

**왜 WebhookEvent를 Payment 안에?**
- PG사 웹훅은 결제 상태 변경의 원천. 결제 없는 웹훅 이벤트는 의미 없음
- 멱등성 체크: `idempotencyKey`로 중복 웹훅 처리 방지

### Value Objects

```java
// 금액: 불변 + 단위 보장
record Money(long amount, Currency currency) {
    Money add(Money other) { /* 통화 검증 포함 */ }
    Money multiply(int quantity) { /* 오버플로우 방지 */ }
}

// 결제 ID: Long 래핑 → 타입 안전성
record PaymentId(long value) {}

// 멱등성 키: UUID 기반
record IdempotencyKey(String value) {
    static IdempotencyKey generate() { return new IdempotencyKey(UUID.randomUUID().toString()); }
}
```

### Domain Events

| 이벤트 | 발생 시점 | 소비자 |
|--------|----------|--------|
| `PaymentCompleted` | 결제 성공 확정 | Dashboard BC (수익 집계) |
| `PaymentFailed` | 결제 최종 실패 | Notification (고객 알림) |
| `PaymentRefunded` | 환불 완료 | Subscription BC (구독 상태 갱신) |

**Domain Event → Integration Event 변환**
- Domain Event: Payment Aggregate 내부 상태 변경 알림 (동기, 트랜잭션 내)
- Integration Event: Transactional Outbox → Kafka → 타 BC 전달 (비동기)
- 이 분리로 BC 간 결합도를 낮추고, 장애 격리를 달성

### Aggregate 경계 결정 근거

**Q. 왜 Coupon과 Payment를 하나의 Aggregate로?**

쿠폰은 두 종류가 있고, 종류에 따라 처리 방식이 다르다:

| 쿠폰 종류 | 처리 방식 | 이유 |
|----------|---------|------|
| **필수 할인 쿠폰** (결제 금액에 반영) | API 레이어에서 사전 검증 → 유효한 경우에만 Payment 생성 | 유효하지 않은 쿠폰으로 결제 진입 자체를 막음 |
| **선택 리워드 쿠폰** (포인트, 캐시백 등) | Payment와 별도 트랜잭션 (`REQUIRES_NEW`) | 리워드 실패가 결제를 롤백하면 안 됨 |

**불변식: 필수 할인 쿠폰에만 적용**

> "Payment 생성 시점에 쿠폰이 포함된 경우, 해당 쿠폰은 이미 사전 검증된 것이다.
> 결제 완료와 쿠폰 사용 처리는 같은 트랜잭션에서 원자적으로 처리된다."

즉, Payment Aggregate 안에 Coupon이 들어올 때는 이미 유효성이 보장된 상태.
유효하지 않은 쿠폰 코드는 API 레이어(`PaymentFacade`)에서 거부 → Payment 자체가 생성되지 않음.

이 불변식이 깨지면 (결제 성공 + 쿠폰 미적용) 고객 불만이 발생한다.
→ EXPERIENCE-STORIES.md Episode #1의 핵심 문제

**Q. 왜 Subscription을 Payment Aggregate에 포함하지 않는가?**

Subscription의 생명주기(월 단위 갱신, 플랜 변경)는 Payment(단건 거래)와 다르다.
Payment가 완료된 뒤, Subscription은 Domain Event를 받아 **자신의 페이스**로 상태를 변경한다.
→ 두 Aggregate를 하나로 합치면 트랜잭션 범위가 너무 커지고, 각자의 불변식을 유지하기 어려워진다.

---

## Subscription Bounded Context

### Aggregate: Subscription

```
Subscription (Aggregate Root)
├── id: SubscriptionId
├── customerId: CustomerId
├── plan: SubscriptionPlan           ← Value Object (FREE / STARTER / PROFESSIONAL)
├── status: SubscriptionStatus       ← Enum (ACTIVE / SUSPENDED / CANCELLED)
├── billingCycle: BillingCycle       ← Value Object (MONTHLY / YEARLY)
├── currentPeriod: DateRange         ← Value Object (시작일 ~ 종료일)
└── usageLimit: UsageLimit           ← Value Object (API 호출 횟수, 데이터 용량)
```

### Domain Events

| 이벤트 | 발생 시점 | 소비자 |
|--------|----------|--------|
| `SubscriptionActivated` | 구독 활성화 | Collection BC (크롤링 활성화) |
| `SubscriptionSuspended` | 구독 정지 (미납 등) | Collection BC (크롤링 중단) |
| `SubscriptionPlanChanged` | 플랜 변경 | Collection BC (크롤링 설정 갱신) |

---

## Dashboard Bounded Context

### Aggregate: DashboardReport

```
DashboardReport (Aggregate Root)
├── id: ReportId
├── shopId: ShopId
├── period: DateRange                ← Value Object
├── metrics: ReviewMetrics           ← Value Object (리뷰 수, 평점, 응답률)
├── salesMetrics: SalesMetrics       ← Value Object (매출, 주문 수)
└── platformBreakdown: Map<PlatformType, PlatformMetrics>
```

**특이점**: DashboardReport는 **읽기 최적화** Aggregate.
- 쓰기(집계)는 `CollectionData` 이벤트를 받아 Spring Batch로 처리
- 읽기는 Caffeine(L1) + Redis(L2) 캐시로 응답
- CQRS 패턴: 쓰기 모델(Aggregate)과 읽기 모델(캐시 + 프로젝션)을 분리

### Ubiquitous Language

| 도메인 용어 | 의미 | 주의 |
|------------|------|------|
| Shop | 고객이 운영하는 매장 | 기업 고객(Tenant)과 다름 |
| Platform | 외부 데이터 소스 (배달앱, 커머스 등) | 내부 서비스와 구분 |
| Metrics | 특정 기간의 집계 수치 | 실시간 원본 데이터와 다름 |
| CollectionJob | 외부 플랫폼에서 데이터를 가져오는 작업 단위 | Task/Batch와 혼용 금지 |
| Session | 외부 플랫폼 인증 세션 | HTTP Session과 다름 |

---

## Collection Bounded Context

### Aggregate: CollectionJob

```
CollectionJob (Aggregate Root)
├── id: JobId
├── shopId: ShopId
├── platform: PlatformType           ← Enum (PLATFORM_A, B, C, D, E, F)
├── status: JobStatus                ← Enum (PENDING → RUNNING → COMPLETED / FAILED)
├── retryCount: int                  ← 재시도 횟수 추적
├── circuitState: CircuitBreakerState ← Value Object (CLOSED / OPEN / HALF_OPEN)
└── result: CollectionResult         ← Value Object (성공 시 수집된 데이터 요약)
```

**왜 CircuitBreakerState를 Aggregate 안에?**
- 플랫폼별 장애 상태가 비즈니스 상태의 일부다
- "이 플랫폼은 현재 차단 상태" = 도메인 불변식
- Resilience4j 외부 상태와 별도로 도메인 수준에서 추적 (장애 이력 보존)

### Domain Events

| 이벤트 | 발생 시점 | 소비자 |
|--------|----------|--------|
| `CollectionCompleted` | 수집 성공 | Dashboard BC (집계 트리거) |
| `CollectionFailed` | 최종 실패 (재시도 소진) | Notification (운영 알림) |
| `CircuitOpened` | 서킷 브레이커 Open | Monitoring (대시보드 경보) |

---

## 도메인 모델과 포트폴리오 연결

| DDD 개념 | 적용 위치 | 에피소드 |
|---------|----------|---------|
| Aggregate 경계 (Payment + Coupon) | `@Transactional` 범위 결정 | #1 |
| 불변식 보호 (중복 결제 방지) | `IdempotencyKey` + 유니크 제약 | #1 |
| 분산 환경 상호 배제 | Redisson 분산락 (Aggregate 수정 직렬화) | #2 |
| CQRS (읽기/쓰기 분리) | Dashboard Caffeine+Redis 캐시 계층 | #3, #6 |
| Domain Event → Integration Event | Transactional Outbox Pattern | #4 |
| Aggregate 상태 모델 (CircuitState) | Resilience4j + 도메인 상태 동기화 | #5 |
| Lease 기반 Aggregate 접근 | Redis 분산 큐 + 세션 풀 관리 | #7 |
