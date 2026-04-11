# TDD 케이스 가이드

> **목적**: platform-api(Java) 구현 시 TDD 사이클(Red → Green → Refactor)을 적용한
> 실제 케이스를 기록한다. "테스트가 설계를 주도한다"는 원칙을 코드로 증명한다.
>
> **작성일**: 2026-04-11

---

## TDD 원칙

```
Red   → 실패하는 테스트 먼저 작성 (구현 없음)
Green → 테스트를 통과하는 최소한의 구현
Refactor → 중복 제거 + 의도 명확화 (테스트는 여전히 통과)
```

**이 저장소에서 TDD를 쓰는 이유**

- 면접관이 묻는 "테스트 어떻게 쓰시나요?" → TDD 사이클로 설계한 코드 제시
- 구현 완료 후 테스트 추가 = 테스트가 구현을 검증 / TDD = 테스트가 설계를 주도
- 경계 케이스(엣지 케이스)를 구현 전에 발견할 수 있음

---

## Case 1: 결제 멱등성 처리 (Episode #1)

### 비즈니스 요건

> "동일한 `idempotencyKey`로 두 번 결제 요청이 들어오면, 두 번째는 처음 결제 결과를 그대로 반환해야 한다."

### Red: 실패하는 테스트

```java
@Test
@DisplayName("동일한 idempotencyKey로 두 번 결제 요청 시 첫 번째 결과를 반환한다")
void shouldReturnExistingPaymentForDuplicateIdempotencyKey() {
    // given
    IdempotencyKey key = IdempotencyKey.of("order-12345-retry");
    PaymentRequest request = PaymentRequest.builder()
        .customerId(CustomerId.of(1L))
        .amount(Money.of(10000, Currency.KRW))
        .idempotencyKey(key)
        .build();

    // when: 첫 번째 결제
    PaymentResult first = paymentService.pay(request);

    // when: 두 번째 결제 (동일 key)
    PaymentResult second = paymentService.pay(request);

    // then: 두 번 모두 같은 결제 ID 반환
    assertThat(second.paymentId()).isEqualTo(first.paymentId());

    // then: DB에 결제 레코드는 하나만 존재
    long count = paymentRepository.countByIdempotencyKey(key);
    assertThat(count).isEqualTo(1);
}
```

**이 시점에서 컴파일 에러**: `IdempotencyKey`, `PaymentRequest`, `PaymentResult` 클래스 없음  
→ 이것이 TDD: 테스트가 인터페이스(API)를 먼저 정의

### Green: 최소한의 구현

```java
// IdempotencyKey Value Object
public record IdempotencyKey(String value) {
    public static IdempotencyKey of(String value) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException("빈 값 불가");
        return new IdempotencyKey(value);
    }
}

// PaymentService
@Service
@Transactional
public class PaymentService {
    public PaymentResult pay(PaymentRequest request) {
        // 멱등성 체크: 동일 key 존재 시 기존 결과 반환
        return paymentRepository
            .findByIdempotencyKey(request.idempotencyKey())
            .map(PaymentResult::from)  // 기존 결제 결과 반환
            .orElseGet(() -> processNewPayment(request));  // 신규 결제
    }
}
```

**테스트 통과** ← Green

### Refactor: 개선 포인트

```java
// Before: 동시 요청 시 race condition 가능
.orElseGet(() -> processNewPayment(request));

// After: unique constraint로 최종 방어선 추가
// DB 레벨에서 idempotency_key에 UNIQUE 제약 → 중복 INSERT 시 DataIntegrityViolationException
// 이를 catch해서 기존 결제 재조회
try {
    return processNewPayment(request);
} catch (DataIntegrityViolationException e) {
    return paymentRepository.findByIdempotencyKey(request.idempotencyKey())
        .map(PaymentResult::from)
        .orElseThrow(() -> new PaymentException("멱등성 처리 실패"));
}
```

### 발견한 엣지 케이스

- **동시 요청**: 같은 key로 100ms 간격으로 2개 요청이 들어오면?
  → DB UNIQUE 제약이 최종 방어선 역할
  → 테스트: `@RepeatedTest(100)` + `ExecutorService`로 동시 실행 검증
- **만료된 key**: idempotency key TTL 정책 필요
  → 결정: 1시간 TTL (DB에서 scheduled cleanup)

---

## Case 2: @Transactional REQUIRES_NEW 격리 (Episode #1)

### 비즈니스 요건

> "결제 완료 후 포인트 적립(리워드) 실패 시 결제 자체는 유지되어야 한다."
>
> **필수 할인 쿠폰 vs 선택 리워드 쿠폰 구분**:
> - 필수 할인 쿠폰: API 레이어에서 사전 검증 → 유효하지 않으면 결제 요청 자체를 거부 (DOMAIN-MODEL.md 참고)
> - 선택 리워드(포인트, 캐시백): 결제 성공 후 적립 시도 → 실패해도 결제는 유지

### Red

```java
@Test
@DisplayName("포인트 적립 실패 시 결제는 COMPLETED 상태를 유지한다")
void paymentShouldSurviveRewardFailure() {
    // given: 포인트 적립 서비스가 일시적으로 실패하는 상황
    doThrow(new RewardServiceUnavailableException())
        .when(rewardService).accumulatePoints(any());

    PaymentRequest request = PaymentRequest.builder()
        .customerId(CustomerId.of(1L))
        .amount(Money.of(10000, Currency.KRW))
        .build();

    // when: 결제 요청 — 예외 없이 완료되어야 함
    PaymentResult result = paymentService.pay(request);

    // then: 결제는 COMPLETED
    assertThat(result.status()).isEqualTo(PaymentStatus.COMPLETED);

    // then: DB에도 COMPLETED로 저장
    Payment saved = paymentRepository.findById(result.paymentId()).orElseThrow();
    assertThat(saved.status()).isEqualTo(PaymentStatus.COMPLETED);
}
```

**이 테스트가 TDD로서 올바른 이유**:
- 예외가 밖으로 나오지 않는다 (Green 구현과 일치)
- DB 상태까지 검증한다 (단순 반환값 검증이 아님)

### Green: REQUIRES_NEW 적용

```java
// RewardService를 별도 Bean으로 분리 (self-invocation 방지)
@Service
public class RewardService {
    @Transactional(propagation = Propagation.REQUIRES_NEW)  // 독립 트랜잭션
    public void accumulatePoints(PaymentId paymentId) {
        // 실패 시 이 트랜잭션만 롤백. 외부 트랜잭션(결제)은 영향 없음
    }
}

@Service
@Transactional
public class PaymentService {
    public PaymentResult pay(PaymentRequest request) {
        Payment payment = processPayment(request);  // 결제 완료

        try {
            rewardService.accumulatePoints(payment.id());  // 독립 트랜잭션
        } catch (RewardServiceUnavailableException e) {
            log.warn("포인트 적립 실패, 결제는 유지: paymentId={}", payment.id());
            // 결제 트랜잭션은 롤백하지 않음 — 리워드는 비핵심 기능
        }

        return PaymentResult.from(payment);
    }
}
```

**필수 할인 쿠폰은 어떻게?**

```java
// API 레이어에서 사전 검증 (PaymentFacade)
public PaymentResult initiatePayment(PaymentRequest request) {
    // 쿠폰이 포함된 경우 사전 검증
    if (request.hasCoupon()) {
        Coupon coupon = couponRepository.findByCode(request.couponCode())
            .orElseThrow(CouponNotFoundException::new);  // ← 여기서 거부
        coupon.validateUsable(request.customerId());    // 사용 조건 검증
    }
    // 이 시점 이후에는 쿠폰이 유효함이 보장됨
    return paymentService.pay(request);
}
```

### Refactor: Self-invocation 트랩 문서화

```java
// 이렇게 하면 안 됨 — this.applyCoupon()은 Spring 프록시를 거치지 않음
@Service
@Transactional
public class PaymentService {
    public PaymentResult pay(...) {
        ...
        this.applyCoupon(...);  // ❌ REQUIRES_NEW 무시됨 — 프록시 바이패스
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void applyCoupon(...) { ... }
}

// self-invocation 검증 테스트
@Test
@DisplayName("self-invocation 시 REQUIRES_NEW가 무시됨을 검증")
void selfInvocationBypassesProxy() {
    // Testcontainers + @Transactional 실제 DB 연결로만 검증 가능
    // 이 테스트는 실패해야 정상 (의도된 문서화 테스트)
}
```

---

## Case 3: 분산 락 획득 실패 처리 (Episode #2)

### 비즈니스 요건

> "동일 ShopId에 대한 크론잡이 다중 인스턴스에서 중복 실행되면 안 된다."

### Red

```java
@Test
@DisplayName("분산 락이 걸려있을 때 두 번째 시도는 예외를 던진다")
void secondLockAttemptShouldFail() throws InterruptedException {
    ShopId shopId = ShopId.of(100L);
    CountDownLatch latch = new CountDownLatch(1);
    AtomicReference<Exception> secondException = new AtomicReference<>();

    // 첫 번째 스레드: 락 획득 후 유지
    Thread first = new Thread(() -> {
        crawlService.lockAndCrawl(shopId, () -> {
            latch.countDown();       // 락 획득 알림
            sleep(2000);             // 락 보유 중
        });
    });

    // 두 번째 스레드: 락 획득 시도
    Thread second = new Thread(() -> {
        latch.await();               // 첫 번째가 락 획득 대기
        try {
            crawlService.lockAndCrawl(shopId, () -> {});  // 실패해야 함
        } catch (LockAcquisitionException e) {
            secondException.set(e);
        }
    });

    first.start(); second.start();
    first.join(); second.join();

    assertThat(secondException.get()).isInstanceOf(LockAcquisitionException.class);
}
```

### Green: Redisson tryLock (Watchdog 방식)

```java
@Service
public class CrawlService {
    // leaseTime을 명시하지 않음 → Watchdog 활성화
    // Watchdog: 락 보유 중인 JVM이 살아있는 한 TTL 자동 갱신 (기본 10초마다)
    // JVM 크래시 시 → Watchdog 중단 → TTL 만료 (약 30초) → 좀비 락 자동 해제

    public void lockAndCrawl(ShopId shopId, Runnable task) {
        RLock lock = redissonClient.getLock("lock:crawl:" + shopId.value());
        boolean acquired = lock.tryLock(0, TimeUnit.SECONDS);  // waitTime=0, leaseTime 생략

        if (!acquired) {
            throw new LockAcquisitionException("이미 실행 중인 크론잡: " + shopId);
        }

        try {
            task.run();
        } finally {
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();  // 정상 종료 시 즉시 해제
            }
        }
    }
}
```

**leaseTime 명시 vs Watchdog 비교**

| | leaseTime 명시 (`tryLock(0, 30, SECONDS)`) | Watchdog (`tryLock(0, SECONDS)`) |
|---|---|---|
| TTL | 고정 30초 | 자동 갱신 |
| 30초 이상 걸리는 작업 | 작업 중 락 만료 → 다른 인스턴스 진입 가능 | 작업 완료까지 락 유지 |
| JVM 크래시 | TTL 남은 시간 후 해제 | ~30초 후 해제 (Watchdog 기본값) |
| **크론잡 적합성** | ❌ 작업 시간 예측 필요 | ✅ 작업 길이 무관하게 안전 |

**결론**: 크론잡처럼 실행 시간이 가변적인 경우 Watchdog 방식이 적합. leaseTime 방식은 작업 시간이 명확히 bounded된 경우에만 사용.

---

## Case 4: Cache Stampede 방지 (Episode #6)

### 비즈니스 요건

> "캐시 만료 시점에 동시 요청 N개가 몰려도 DB에 한 번만 쿼리를 보내야 한다."

### Red (동시성 테스트)

```java
@Test
@DisplayName("캐시 만료 시 동시 100개 요청 중 DB 쿼리는 1번만 발생한다")
void stampedePrevention() throws InterruptedException {
    ShopId shopId = ShopId.of(1L);
    AtomicInteger dbQueryCount = new AtomicInteger(0);

    // DB 쿼리 카운팅 모의
    when(shopRepository.findById(shopId)).thenAnswer(inv -> {
        dbQueryCount.incrementAndGet();
        Thread.sleep(50);  // DB 응답 지연 시뮬레이션
        return Optional.of(new Shop(shopId));
    });

    int concurrency = 100;
    ExecutorService executor = Executors.newFixedThreadPool(concurrency);
    CountDownLatch start = new CountDownLatch(1);
    List<Future<?>> futures = new ArrayList<>();

    for (int i = 0; i < concurrency; i++) {
        futures.add(executor.submit(() -> {
            start.await();
            dashboardService.getShopMetrics(shopId);
            return null;
        }));
    }

    start.countDown();  // 동시 시작
    for (Future<?> f : futures) f.get();

    assertThat(dbQueryCount.get()).isEqualTo(1);  // DB는 한 번만
}
```

### Green: @Cacheable(sync=true) + Redisson 분산락

```java
@Service
public class DashboardService {
    @Cacheable(value = "shopMetrics", key = "#shopId.value", sync = true)
    public ShopMetrics getShopMetrics(ShopId shopId) {
        // sync=true: JVM 내 동시 요청은 직렬화됨
        // 다중 인스턴스: Redisson으로 추가 보호 (Double-Check)
        return shopRepository.findById(shopId)
            .map(this::buildMetrics)
            .orElseThrow();
    }
}
```

---

## 테스트 계층 전략

```
┌─────────────────────────────────────────────────────┐
│ E2E Test (소수)                                       │
│ - k6 부하 테스트 (P99 목표 달성 검증)                 │
│ - 전체 흐름: 결제 → Kafka → 집계 → 캐시               │
├─────────────────────────────────────────────────────┤
│ Integration Test (중간)                               │
│ - Testcontainers: MySQL + Redis + Kafka 실제 연결     │
│ - @Transactional 격리 레벨 검증                       │
│ - 분산 락 race condition 검증                         │
├─────────────────────────────────────────────────────┤
│ Unit Test (다수)                                      │
│ - Aggregate 도메인 로직                               │
│ - Value Object 불변식                                 │
│ - Service 비즈니스 규칙 (Mock 사용)                   │
└─────────────────────────────────────────────────────┘
```

**핵심 원칙**: 동시성/분산 관련 버그는 Unit Test로 잡기 불가.
→ Testcontainers 기반 Integration Test 필수.
