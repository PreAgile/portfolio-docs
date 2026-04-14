# 실험 일지 (Experiment Log)

> **용도**: 각 Deep Dive Track에서 "당해보기 → 측정 → 딥다이브 → 해결"하면서 기록하는 실험 일지.
> 감이 아니라 **가설 → 실험 → 결과 → 발견**으로 기록한다.
> 이 파일 자체가 기술 블로그 포스팅의 원본 소스이자 면접 스토리의 근거다.

---

## 기록 형식

```
### [실험 제목]

**날짜**: YYYY-MM-DD
**Track**: Track N — 주제
**가설**: "~하면 ~할 것이다"
**실험 방법**: (코드, 명령어, 테스트 시나리오)
**결과**: (실측 수치 또는 관찰 — 스크린샷/로그 가능)
**발견**: (예상과 다른 점, 새로 배운 것)
**다음 질문**: (이 결과에서 파생된 다음 실험)
**면접 한 줄**: (이 실험으로 면접에서 말할 수 있는 것)
```

---

## Track 0 — 측정 기반 구축

### docker-compose 환경 + k6 기준선 측정

**날짜**: (예정)
**Track**: Track 0 — 측정 기반 구축
**가설**: "Spring Boot 기본 API (GET /health)는 docker-compose 로컬 환경에서 최소 5,000 TPS 이상 나올 것이다"
**실험 방법**: `docker-compose up -d` → Spring Boot 앱 기동 → `k6 run --vus 100 --duration 30s`
**결과**: (실측 후 기록)
**발견**: (실측 후 기록)
**다음 질문**: "기준선 대비 분산 락/캐시/CB 추가 시 얼마나 감소하는가?"
**면접 한 줄**: "모든 최적화의 Before/After는 이 기준선 위에서 측정했습니다"

---

## Track 1 — 동시성 & 분산 락

### 락 없이 100 스레드 동시 토큰 갱신 — lost update 재현

**날짜**: (예정)
**Track**: Track 1 — 동시성 & 분산 락
**가설**: "락 없이 100 스레드가 동시에 같은 토큰을 갱신하면, 최종 refreshCount가 100보다 적을 것이다 (lost update)"
**실험 방법**:
```java
// ExecutorService로 100 스레드 동시 실행
ExecutorService executor = Executors.newFixedThreadPool(100);
CountDownLatch latch = new CountDownLatch(100);
IntStream.range(0, 100).forEach(i ->
    executor.submit(() -> { noLockTokenService.refresh(tokenId); latch.countDown(); })
);
latch.await();
// 기대 refreshCount: 100
// 실제 refreshCount: ???
```
**결과**: (실측 후 기록)
**발견**: (실측 후 기록)
**다음 질문**: "synchronized를 적용하면 정합성은 보장되지만 TPS는 얼마나 감소하는가?"
**면접 한 줄**: "락 없이 100 스레드 동시 갱신 시 X건의 lost update가 발생하는 것을 실험으로 확인했습니다"

### synchronized vs 분산 환경 — JVM 락의 한계 증명

**날짜**: (예정)
**Track**: Track 1 — 동시성 & 분산 락
**가설**: "synchronized는 단일 JVM에서만 동작하므로, 2개 인스턴스에서 동시 요청 시 다시 데이터 불일치가 발생할 것이다"
**실험 방법**: Spring Boot 앱 2개 인스턴스 기동 → 각 인스턴스에 50 스레드씩 동시 요청
**결과**: (실측 후 기록)
**발견**: (실측 후 기록)
**다음 질문**: "DB FOR UPDATE vs Redis 분산 락의 TPS 차이는?"
**면접 한 줄**: "2개 인스턴스에서 synchronized가 무력화되는 것을 실측으로 증명했고, 이것이 분산 락이 필요한 근거입니다"

### 락 방식별 TPS + 정합성 비교표

**날짜**: (예정)
**Track**: Track 1 — 동시성 & 분산 락
**가설**: "Redisson 분산 락은 DB FOR UPDATE 대비 TPS가 높고, 정합성도 보장할 것이다"
**실험 방법**: 동일 시나리오 (100 스레드, 같은 계좌 출금)를 4가지 방식으로 실행

| 방식 | 정합성 | TPS | P99 |
|------|-------|-----|-----|
| 락 없음 | | | |
| synchronized | | | |
| DB FOR UPDATE | | | |
| Redisson | | | |

**결과**: (실측 후 기록)
**발견**: (실측 후 기록)
**다음 질문**: "Redisson watchdog의 자동 연장이 실제로 동작하는지 확인 — 30초 이상 걸리는 처리에서 락이 풀리지 않는지"
**면접 한 줄**: "4가지 락 방식의 TPS와 정합성을 실측 비교표로 가지고 있습니다"

---

## Track 2 — Kafka & 메시지 안정성

### auto-commit + Consumer 강제 종료 — 메시지 유실 재현

**날짜**: (예정)
**Track**: Track 2 — Kafka & 메시지 안정성
**가설**: "enable.auto.commit=true 상태에서 Consumer를 처리 중간에 강제 종료하면, 커밋은 됐지만 처리 안 된 메시지가 유실될 것이다"
**실험 방법**:
```bash
# 1. 100개 메시지 발행
# 2. Consumer가 50개 처리 중 kill -9
# 3. Consumer 재시작 후 처리된 총 메시지 수 확인
# 기대: 50~100 사이 (auto-commit 타이밍에 따라 일부 유실)
```
**결과**: (실측 후 기록)
**발견**: (실측 후 기록)
**다음 질문**: "manual-commit으로 바꾸면 유실은 없지만 중복은 발생하는가?"
**면접 한 줄**: "auto-commit에서 Consumer를 강제 종료하면 메시지가 유실되는 것을 직접 실험으로 확인했습니다"

### manual-commit + Idempotent Consumer — 유실도 중복도 없는 구현

**날짜**: (예정)
**Track**: Track 2 — Kafka & 메시지 안정성
**가설**: "manual-commit + processed_events 테이블로 멱등성을 보장하면, 동일 메시지를 3번 발행해도 DB에 1건만 저장될 것이다"
**실험 방법**: 동일 메시지 ID로 3회 발행 → DB 레코드 수 확인
**결과**: (실측 후 기록)
**발견**: (실측 후 기록)
**다음 질문**: "Rebalancing 발생 시 처리가 얼마나 중단되는가?"
**면접 한 줄**: "At-least-once + Idempotent Consumer로 실질적 Exactly-once를 달성했고, 중복 발행 테스트로 검증했습니다"

---

## Track 3 — 캐시 & Stampede 방지

### TTL 동시 만료 — Cache Stampede 재현

**날짜**: (예정)
**Track**: Track 3 — 캐시 & Stampede 방지
**가설**: "TTL=60초인 캐시 키가 만료되는 순간 100 RPS가 들어오면, 100개 요청이 모두 DB로 향할 것이다"
**실험 방법**: Redis에 캐시 저장 (TTL=5초) → TTL 만료 직후 k6로 100 동시 요청 → DB 쿼리 로그 수 확인
**결과**: (실측 후 기록)
**발견**: (실측 후 기록)
**다음 질문**: "분산 락으로 Stampede를 방지하면 DB 요청이 1건으로 줄어드는가?"
**면접 한 줄**: "캐시 TTL 만료 순간 100개 요청이 동시에 DB로 가는 것을 실험으로 재현하고, 분산 락으로 1건으로 줄였습니다"

---

## Track 4 — 장애 격리 & 복원력

### Circuit Breaker 없이 외부 장애 전파 — 스레드 풀 고갈 재현

**날짜**: (예정)
**Track**: Track 4 — 장애 격리 & 복원력
**가설**: "외부 API가 3초 timeout을 반환할 때, Circuit Breaker 없이는 우리 서비스의 전체 P99가 3초 이상이 될 것이다"
**실험 방법**: WireMock으로 3초 지연 설정 → k6로 100 RPS → 내부 API (/health)의 P99도 함께 측정
**결과**: (실측 후 기록)
**발견**: (실측 후 기록)
**다음 질문**: "Circuit Breaker를 적용하면 내부 API P99는 정상으로 돌아오는가?"
**면접 한 줄**: "외부 API 3초 timeout이 내부 서비스 전체를 마비시키는 것을 실험으로 재현했고, CB 도입 후 내부 P99는 정상으로 복귀했습니다"

---

## Track 5 — 이벤트 드리븐 & Outbox

### 직접 Kafka 발행 — 크래시 시 유실 재현

**날짜**: (예정)
**Track**: Track 5 — 이벤트 드리븐 & Outbox
**가설**: "DB 저장 후 kafkaTemplate.send() 직전에 예외가 발생하면, DB에는 저장되지만 Kafka에는 메시지가 없을 것이다"
**실험 방법**: Service 코드에서 DB 저장 → RuntimeException 주입 → Kafka 토픽 메시지 수 확인
**결과**: (실측 후 기록)
**발견**: (실측 후 기록)
**다음 질문**: "Outbox 테이블 + Relay로 바꾸면 크래시 후에도 메시지가 최종 발행되는가?"
**면접 한 줄**: "DB 저장 후 Kafka 발행 전에 크래시가 나면 이벤트가 유실되는 것을 실험으로 증명하고, Outbox Pattern으로 해결했습니다"

---

## 아카이브: 초기 학습 기록 (2026-04-03)

> Track 구조 적용 전 기록. 참고용으로 보존.

**ADR-001에서 배운 것**:
- Kafka와 RabbitMQ의 근본적 차이: Kafka는 로그 기반(메시지 보존), RabbitMQ는 큐 기반(소비 후 삭제)
- Consumer Group의 개념: 같은 토픽을 독립적으로 여러 서비스가 소비할 수 있음
- 파티션 수 = Consumer 최대 병렬 처리 수

**ADR-002에서 배운 것**:
- Coroutines는 경량 스레드가 아니라 "중단 가능한 계산 단위"
- `suspend` 함수는 스레드를 점유하지 않고 중단 → 같은 스레드에서 다른 코루틴 실행 가능
- JPA + Coroutines 조합 시 `withContext(Dispatchers.IO)` 필수 이유: JPA는 블로킹 API

**ADR-003에서 배운 것**:
- Cache Stampede: 캐시 만료 순간 다수 요청이 동시에 DB로 → DB 과부하
- Double-Check Locking: 락 획득 후 다시 캐시 확인하는 이유
- Redisson 분산락이 직접 구현 대비 나은 이유: `lua script`로 원자적 처리

**아직 모르는 것** (→ 각 Track에서 실험으로 해결):
- Testcontainers로 실제 Kafka 통합 테스트 → Track 2
- Spring Kafka의 Manual Commit 조합 → Track 2
- Outbox Relay 구현 방법 → Track 5
