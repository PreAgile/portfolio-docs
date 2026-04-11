# ADR-005: Transactional Outbox Relay — 폴링 vs CDC

- **상태**: 확정
- **날짜**: 2026-04-11
- **결정자**: 본인
- **연결 에피소드**: Episode #4 (외부 API 실패 시 이벤트 유실 없는 재처리)

---

## 배경과 문제

### Dual-Write 문제

```
// 잘못된 방식 (Dual-Write)
@Transactional
public PaymentResult pay(PaymentRequest request) {
    Payment payment = paymentRepository.save(payment);  // DB 저장 성공

    kafkaTemplate.send("payment-events", new PaymentCompleted(payment));
    // ↑ DB 커밋 후 Kafka 전송 실패 시? → 이벤트 유실!
    //   DB 저장 전 Kafka 전송 성공 후 DB 실패 시? → 이벤트 중복!

    return PaymentResult.from(payment);
}
```

**해결**: Transactional Outbox Pattern
- DB 트랜잭션 내에서 이벤트를 `outbox_events` 테이블에 저장 (원자적)
- 별도 Relay 프로세스가 이 테이블을 읽어 Kafka에 발행

### 핵심 결정 사항

Relay 프로세스를 어떻게 구현할 것인가?
- **폴링**: 주기적으로 DB를 SELECT해서 미발행 이벤트 처리
- **CDC**: MySQL binlog를 감시해서 변경 즉시 감지

---

## outbox_events 테이블 설계

```sql
CREATE TABLE outbox_events (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    aggregate_type VARCHAR(100) NOT NULL,   -- 'Payment', 'Subscription'
    aggregate_id   VARCHAR(100) NOT NULL,   -- shopId, paymentId
    event_type     VARCHAR(100) NOT NULL,   -- 'PaymentCompleted'
    payload        JSON         NOT NULL,   -- 이벤트 페이로드
    status         ENUM('PENDING', 'SENT', 'FAILED') DEFAULT 'PENDING',
    created_at     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    sent_at        DATETIME(6),
    INDEX idx_status_created (status, created_at)  -- Relay 쿼리 최적화
);
```

---

## 검토한 옵션

### Option A: 폴링 (선택) ✅

**잘못된 구현 (트랜잭션 안에서 Kafka I/O)**

```java
// ❌ 이 방식의 문제: @Transactional 안에서 kafka.send().get() 호출
// → SELECT FOR UPDATE로 잡은 DB 행 락을 Kafka ack 동안 유지
// → Kafka 응답 지연(네트워크) 시간만큼 DB 락 점유 → 경합 증가
@Scheduled(fixedDelay = 5000)
@Transactional
public void relay() {
    List<OutboxEvent> pending = outboxEventRepository.findPendingWithLock(100);
    for (OutboxEvent event : pending) {
        kafkaTemplate.send(event.toKafkaRecord()).get(5, SECONDS);  // ← 문제
        event.markAsSent();
    }
}
```

**올바른 구현 (트랜잭션 분리)**

```java
@Component
public class OutboxRelayScheduler {

    @Scheduled(fixedDelay = 5000)
    public void relay() {
        // 1단계: 트랜잭션 안에서 이벤트 조회 + 상태를 PUBLISHING으로 변경 (락 즉시 해제)
        List<OutboxEvent> pending = outboxEventRepository.fetchAndMarkPublishing(100);

        // 2단계: 트랜잭션 밖에서 Kafka 전송 (DB 락 없는 상태)
        for (OutboxEvent event : pending) {
            try {
                kafkaTemplate.send(event.toKafkaRecord()).get(5, TimeUnit.SECONDS);
                outboxEventRepository.markAsSent(event.getId());      // 3단계: 성공 기록
            } catch (Exception e) {
                outboxEventRepository.markAsFailed(event.getId());    // 3단계: 실패 기록
                log.error("Outbox relay 실패: eventId={}", event.getId(), e);
            }
        }
    }
}

// Repository
@Transactional
public List<OutboxEvent> fetchAndMarkPublishing(int limit) {
    List<OutboxEvent> events = findPendingWithLock(limit);  // SELECT FOR UPDATE SKIP LOCKED
    events.forEach(e -> e.changeStatus(PUBLISHING));        // 상태 변경
    return events;
    // 메서드 종료 시 트랜잭션 커밋 → DB 락 해제
    // 이후 Kafka 전송은 트랜잭션 밖에서 진행
}
```

**PUBLISHING 상태의 역할**
- `PENDING` → `PUBLISHING`: Relay가 처리 중임을 표시 (다른 인스턴스의 중복 선택 방지)
- `PUBLISHING` → `SENT`: Kafka ack 수신 후
- `PUBLISHING` → `FAILED`: Kafka 전송 실패 (재처리 대상)
- 장애 복구: `PUBLISHING` 상태가 10분 이상 지속되면 `PENDING`으로 복구하는 별도 스케줄러

**SELECT FOR UPDATE SKIP LOCKED의 역할**

다중 인스턴스 환경에서 같은 이벤트가 여러 Relay에 의해 중복 선택되는 것을 방지:
- `FOR UPDATE`: 선택된 행 락 (트랜잭션 종료까지)
- `SKIP LOCKED`: 이미 락된 행을 건너뜀 (대기하지 않음)
- `fetchAndMarkPublishing` 트랜잭션 범위: 조회 + 상태 변경만 포함 (Kafka I/O 제외)
- 효과: 각 인스턴스가 겹치지 않는 이벤트를 빠르게 점유 후 락 해제 → Kafka 전송은 병렬

**장점**
- Spring `@Scheduled` 사용 → 별도 인프라 불필요
- 구현 단순, 디버깅 용이
- SELECT FOR UPDATE SKIP LOCKED로 다중 인스턴스 중복 발행 방지
- 재처리 로직 명시적 (FAILED 상태 이벤트 재처리 스케줄러 별도 운영 가능)

**단점**
- 최대 5초 지연 (폴링 주기)
- DB에 주기적 쿼리 부하 (5초마다 SELECT + UPDATE)
- 이벤트 발생이 없는 시간에도 쿼리 발생

**DB 부하 추정**

```
조건: outbox_events 테이블 1만 건 (처리 완료 건은 별도 아카이빙)
인덱스: (status, created_at)
평균 결과: 0~10건

실행 시간 예상: 1~5ms
초당 쿼리: 1000ms / 5000ms = 0.2회/sec
DB 활용률: 0.2 × 5ms = 1ms/sec ≈ 0.1%

→ 무시 가능한 수준
```

---

### Option B: CDC — Debezium

```
MySQL → Debezium Connector → Kafka Connect → Kafka
```

**동작 원리**

MySQL binlog를 감시하여 `outbox_events` INSERT를 실시간 감지 → Kafka에 바로 발행.

**장점**
- 지연 ~ms (binlog 감지 즉시)
- DB 폴링 부하 없음
- 이벤트 발생 시에만 처리 (효율적)

**단점**
- Kafka Connect 클러스터 운영 필요
- MySQL `binlog_format=ROW` 설정 필요
- Debezium Connector 설정, 모니터링, 업그레이드 필요
- 로컬 개발 환경에서 binlog 설정 필요 → 개발 복잡도 증가
- Connector 장애 시 이벤트 지연 or 중복 발행 위험

**결론**: 운영 복잡도가 폴링 대비 유의미하게 높음.

---

### Option C: ApplicationEventPublisher (Spring 내부 이벤트)

```java
@Transactional
public PaymentResult pay(...) {
    Payment payment = paymentRepository.save(payment);

    // 트랜잭션 커밋 후 이벤트 발행
    eventPublisher.publishEvent(new PaymentCompletedEvent(payment));

    return PaymentResult.from(payment);
}

@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onPaymentCompleted(PaymentCompletedEvent event) {
    kafkaTemplate.send("payment-events", ...);  // 트랜잭션 커밋 후 실행
}
```

**장점**
- 코드 가장 단순
- 별도 outbox_events 테이블 불필요

**단점**
- "At-least-once" 미보장: Kafka 전송 실패 시 이벤트 유실
- JVM 재시작 시 in-memory 이벤트 유실
- 재처리 메커니즘 없음

**결론**: 이벤트 유실 가능성이 있으므로 결제 시스템에서는 사용 불가.

---

## 결정: Option A — 폴링 방식, 5초 주기

### 선택 근거

1. **운영 단순성**: Spring `@Scheduled` + JPA만으로 구현 가능, 별도 인프라 없음
2. **5초 지연 허용**: 대시보드 집계는 실시간이 아니어도 됨 (1분 이내 반영으로 충분)
3. **재처리 명시적**: FAILED 상태 이벤트를 별도 스케줄러로 재처리 가능
4. **개발 환경 단순**: Docker Compose에 Kafka Connect/Debezium 추가 불필요

### 재처리 전략

```java
// 실패한 이벤트 재처리 (1시간마다)
@Scheduled(fixedDelay = 3_600_000)
public void retryFailed() {
    List<OutboxEvent> failed = outboxEventRepository
        .findFailedOlderThan(Duration.ofMinutes(10));  // 10분 이상 된 실패만

    // 재처리 로직 (최대 3회 재시도)
}
```

### 이 결정이 틀렸다고 판단할 기준

- 이벤트 지연이 5초를 초과하면 안 되는 SLA가 생길 경우 → CDC 전환 검토
- Outbox 테이블 크기가 통제 불가능하게 증가할 경우 → 아카이빙 전략 재검토
- 폴링으로 인한 DB 부하가 실제 문제가 될 경우 → 폴링 주기 조정 or CDC 전환

---

## AI 검토 내용 (ADR-005)

**내가 물어본 것:**
> "폴링 주기를 100ms vs 5초로 설정했을 때 DB 부하 차이가 얼마나 되는지 알려줘.
> 그리고 SELECT FOR UPDATE SKIP LOCKED가 다중 인스턴스에서 어떻게 동작하는지도."

**AI 답변 요약:**
```
폴링 주기별 부하:
- 100ms: 10회/sec × 5ms = 50ms/sec (DB 활용률 5%)
- 5000ms: 0.2회/sec × 5ms = 1ms/sec (DB 활용률 0.1%)
- 차이: 50배

SKIP LOCKED 동작:
- 인스턴스 A가 행 1~100에 락
- 인스턴스 B가 SELECT 시 1~100 건너뜀, 101~200 처리
- 중복 없이 작업 분산 효과
- 단, 인스턴스 A가 크래시하면 1~100의 락 만료 대기 필요
  (트랜잭션이 끝나면 자동 해제)
```

**내 판단:**
- 100ms 폴링은 오버킬. 5초 지연이 허용 가능한 시스템에서 DB 부하 50배 차이는 합리적이지 않음.
- SKIP LOCKED는 의도한 대로 동작함. 크래시 시 락 해제는 DB 트랜잭션 자동 롤백으로 처리됨.
- 추가로 내가 발견한 것: `LIMIT 100`을 넣어야 함 — 미처리 이벤트가 수만 건 쌓인 경우 한 번에 처리하면 트랜잭션 시간이 너무 길어질 수 있음.

---

## 면접 연결

**Q. "Transactional Outbox Pattern에서 이벤트 중복 발행은 어떻게 처리하나요?"**

```
"두 가지 수준에서 처리합니다.

발행 측 (Relay):
- SELECT FOR UPDATE SKIP LOCKED로 같은 이벤트를 여러 Relay가 동시에 처리하지 않도록 함
- 그러나 이론적으로 동일 이벤트가 두 번 발행될 수 있음
  (Relay 크래시 직후 상태 변경이 롤백되는 케이스)

소비 측 (Consumer):
- Kafka Consumer에서 Idempotent Consumer 패턴 적용
- processed_events(topic, partition, offset) 테이블로 이미 처리된 메시지 스킵
- 이 처리와 비즈니스 로직을 같은 DB 트랜잭션으로 원자적 처리

즉, Outbox는 '발행 보장'에 집중하고, Idempotent Consumer가 '중복 처리 방지'를 담당합니다.
각 레이어가 자신의 책임만 갖도록 분리했습니다."
```
