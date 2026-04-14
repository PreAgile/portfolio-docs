# 백엔드 포트폴리오 전략 — Deep Dive Track

> **핵심**: "이 기술을 써봤다"가 아니라 **"이 문제를 직접 겪어보고, 원리를 파고, 해결한 근거가 있다"**
> 면접은 CS 지식 + 문제 해결 근거 + 딥다이브 경험의 합이다.

---

## 철학

### "당해보기 → 측정 → 딥다이브 → 해결 → 증거 → 스토리"

F-Lab 커리큘럼 분석에서 가져온 원칙. 기술을 먼저 도입하는 게 아니라, **기술이 없을 때의 문제를 먼저 체감**한다.

```
1. 당해보기  — 기술 없이 문제를 직접 재현한다. "왜 필요한가"를 몸으로 느낀다.
2. 측정      — Before 수치를 잡는다. 감이 아니라 데이터로 문제를 정의한다.
3. 딥다이브  — CS 원리까지 파고든다. "어떻게 동작하는가"를 설명할 수 있어야 한다.
4. 해결      — 구현하고 테스트한다. 코드와 테스트가 증거다.
5. 증거      — After 수치를 잡는다. Before/After 비교표가 면접 무기다.
6. 스토리    — 이 경험을 한 문단으로 말할 수 있어야 한다. ADR과 블로그로 남긴다.
```

### 세 가지 기본 원칙

**1. 먼저 측정하고, 그 다음에 개선하라**
성능 테스트 환경(k6 + Grafana)을 Track 0에서 먼저 구축한다. 모든 트랙의 Before/After는 이 인프라 위에서 측정한다.

**2. "왜 안 썼는가"도 답할 수 있어야 한다**
Kafka를 쓴 이유만큼, Redis Streams나 RabbitMQ를 안 쓴 이유도 근거가 있어야 한다. 각 트랙의 딥다이브에서 대안 기술을 반드시 비교한다.

**3. AI를 도구로, 판단은 내가**
```
문제 정의 (내가) → 대안 탐색 (AI + 공식 문서) → 트레이드오프 분석 (내가)
→ 결정 + ADR 작성 → 구현 (AI 보조) → 검증 + 측정 (내가)
```

### 면접에서 주니어와 시니어를 가르는 것

```
주니어: "Kafka를 사용해봤습니다"
합격선: "메시지 유실 문제가 있어서 Manual Commit으로 해결했습니다"
시니어: "auto-commit에서 Consumer 강제 종료 시 유실되는 것을 직접 실험으로 확인했고,
        Manual Commit + Idempotent Consumer 조합을 선택했습니다.
        Exactly-once는 Kafka Streams 의존성과 외부 DB 연동에서의 한계 때문에 배제했습니다.
        Consumer Lag이 급증했을 때는 파티션 수 대비 Consumer 인스턴스를 늘려서 해결했고,
        그 판단 근거는 max.poll.records × 처리시간 < max.poll.interval.ms 공식입니다."
```

이 포트폴리오는 세 번째 수준을 목표로 한다.

---

## Deep Dive Tracks

### 트랙 진행 순서와 의존성

```
Track 0: 측정 기반 구축 ──────────────────────────────────┐
    │                                                      │
    ├── Track 1: 동시성 & 분산 락                            │ 모든 트랙의 Before/After는
    │       │                                              │ Track 0 인프라에서 측정
    │       ├── Track 3: 캐시 & Stampede (분산 락 사용)      │
    │       │                                              │
    ├── Track 2: Kafka & 메시지 안정성                       │
    │       │                                              │
    │       └── Track 5: 이벤트 드리븐 & Outbox (Kafka 사용) │
    │                                                      │
    └── Track 4: 장애 격리 & 복원력 ───────────────────────┘
```

F-Lab이 "분산 락 → Kafka"로 이어지는 파이프라인을 설계한 것처럼, 이 트랙들도 의존성이 있다.
다만 Track 1/2/4는 독립적으로 시작 가능하다.

---

### Track 0: 측정 기반 구축

> "측정할 수 없으면 개선할 수 없다." — 모든 트랙의 전제 조건.

**목표**: Before/After를 측정할 수 있는 인프라를 먼저 갖춘다.

**할 일**:
- [ ] `docker-compose up -d` 후 모든 서비스 healthy 확인
- [ ] Kafka UI (localhost:8989) 접속 → 토픽 생성/메시지 발행 확인
- [ ] Grafana (localhost:3000) 접속 → Prometheus 데이터 소스 연결 확인
- [ ] k6 기본 스크립트로 "Hello World" API에 부하 → Grafana에서 TPS/P99 확인
- [ ] 기준선(baseline) 측정: 아무 기술도 적용하지 않은 Spring Boot 기본 API의 TPS

**완료 기준**: `k6 run` → Grafana 대시보드에서 실시간 TPS/P99/에러율 확인 가능

**연결**: `projects/infra/docker-compose.yml`, `projects/infra/k6/load-test.js`

---

### Track 1: 동시성 & 분산 락

> "락을 왜 쓰는지 모르면, 락 없이 터지는 걸 보여줘라."

**실무 문제**
토큰 값이 동시에 업데이트되면서 덮어씌워지는 동시성 버그. (cmong-mq #388)
여러 인스턴스가 같은 리소스에 동시 접근할 때, 단일 서버의 synchronized로는 해결이 안 된다.

**당해보기 실험**
```
실험 1: 락 없이 100 스레드가 동시에 같은 계좌에서 출금
  → 기대: 잔액 불일치 발생
  → 측정: 최종 잔액 vs 기대 잔액의 차이

실험 2: synchronized로 보호
  → 기대: 단일 서버에서는 정합성 보장
  → 측정: TPS 변화 (락 오버헤드)

실험 3: 2개 서버 인스턴스에서 synchronized 사용
  → 기대: 다시 데이터 불일치 발생 (JVM 락의 한계)
  → 측정: 분산 환경에서 synchronized가 무력화되는 것을 실측으로 증명
```

**CS 딥다이브 체크리스트**
- [ ] Java 메모리 모델: volatile, happens-before
- [ ] synchronized vs ReentrantLock — 공정 락, tryLock(timeout)
- [ ] ConcurrentHashMap 내부: Java 8에서 Segment → CAS + synchronized
- [ ] DB 락: SELECT FOR UPDATE, 갭 락, 데드락 (SHOW ENGINE INNODB STATUS)
- [ ] Optimistic Lock: @Version, 충돌 시 재시도 비용
- [ ] Redis SET NX + Lua: 원자적 락 획득/해제
- [ ] Redisson: watchdog 자동 연장, 재진입 가능, 좀비 락 방지

**구현 목표**
- platform-api에 분산 락 모듈 구현 (Redisson)
- 동시성 테스트: `ExecutorService` 100 스레드 동시 요청
- 락 방식별 비교 테스트 (synchronized / DB FOR UPDATE / Redis SET NX / Redisson)

**측정 기준 (Before/After)**

| 조건 | 데이터 정합성 | TPS | 비고 |
|------|-------------|-----|------|
| 락 없음 | ❌ 불일치 | 높음 | Before |
| synchronized (단일 서버) | ✅ | 감소 | JVM 내부만 |
| synchronized (2 서버) | ❌ 불일치 | - | 분산 환경 한계 증명 |
| DB FOR UPDATE | ✅ | 더 감소 | DB 병목 |
| Redisson | ✅ | 측정 | After |

**면접 스토리**
> "실무에서 동시 요청으로 토큰이 덮어씌워지는 버그를 겪었습니다.
> 단일 서버 synchronized → 분산 환경에서 무력화 → DB 락은 커넥션 병목 → Redis 분산 락으로 해결.
> 각 단계를 실험하고, 락 방식별 TPS와 정합성을 실측 비교했습니다.
> Redisson을 선택한 이유는 watchdog 자동 연장으로 좀비 락을 방지하면서도 성능 오버헤드가 적었기 때문입니다."

**연결 문서**
- [ADR-004: 분산 락 구현 방식](docs/adr/ADR-004-distributed-lock.md)
- [depth-guide §2: DB 락 & 동시성](docs/interview-prep/depth-guide.md#2-db--락--동시성)
- [Episode #2: 분산 락](EXPERIENCE-STORIES.md)

---

### Track 2: Kafka & 메시지 안정성

> "Kafka는 결국 로그다. 이 한 문장이 와닿는 순간, Consumer/Partition/Offset이 전부 연결된다."

**실무 문제**
로그 버퍼 누락으로 플랫폼 데이터가 잘림 (cmong-mq #394).
Consumer 재시작 시 메시지가 유실되거나 중복 처리되는 문제.

**당해보기 실험**
```
실험 1: enable.auto.commit=true + Consumer를 처리 중간에 강제 종료 (kill -9)
  → 기대: 메시지 유실 발생 (커밋은 됐지만 처리 안 됨)
  → 측정: 발행한 메시지 수 vs 실제 처리된 메시지 수

실험 2: enable.auto.commit=false + 처리 후 수동 커밋
  → 기대: 유실 없음. 단, 커밋 전 재시작 시 중복 처리 발생
  → 측정: 중복 처리된 메시지 수

실험 3: 수동 커밋 + Idempotent Consumer (processed_events 테이블)
  → 기대: 유실도 없고, 중복 처리도 방지
  → 측정: DB에 저장된 레코드 수 = 발행한 메시지 수 (정확히 일치)

실험 4: Consumer 2개 → Rebalancing 발생 시키기
  → 기대: Rebalancing 동안 메시지 처리 중단 (stop-the-world)
  → 측정: Rebalancing 소요 시간, 처리 중단 구간
```

**CS 딥다이브 체크리스트**
- [ ] Kafka = 분산 커밋 로그: append-only, sequential I/O가 빠른 이유
- [ ] Partition: 순서 보장 단위, 파티션 키 선택이 중요한 이유
- [ ] Consumer Group: 같은 그룹 내 파티션 분배, 다른 그룹은 독립 소비
- [ ] Offset: `__consumer_offsets` 토픽, 자동 vs 수동 커밋
- [ ] Rebalancing: 발생 조건, Cooperative Sticky Assignor로 stop-the-world 최소화
- [ ] ISR (In-Sync Replicas): acks=all의 의미, min.insync.replicas
- [ ] max.poll.records × 처리시간 < max.poll.interval.ms 공식
- [ ] Exactly-once: Transactional Producer + Consumer의 한계 (외부 DB 연동 시)
- [ ] "Kafka 대신 Redis로는 왜 안 되는가?" — Redis Streams vs Kafka 비교
- [ ] "폴링이나 웹훅과의 차이는?" — 비동기 메시징이 필요한 순간

**구현 목표**
- platform-event-consumer: Manual Commit + Idempotent Consumer + DLQ
- Testcontainers 기반 Kafka 통합 테스트
- Consumer Lag 메트릭 → Prometheus → Grafana

**측정 기준 (Before/After)**

| 조건 | 메시지 유실 | 중복 처리 | Consumer Lag |
|------|-----------|---------|-------------|
| auto-commit + kill | 유실 발생 | - | Before |
| manual-commit + kill | 유실 없음 | 중복 발생 | - |
| manual + Idempotent | 유실 없음 | 중복 없음 | After |
| Rebalancing 중 | 처리 중단 | - | 측정 |

**면접 스토리**
> "실무에서 메시지 유실 문제를 겪었고, Kafka로 재설계했습니다.
> auto-commit에서 Consumer를 강제 종료하면 메시지가 유실되는 것을 직접 실험으로 확인했고,
> Manual Commit + Idempotent Consumer 조합을 선택했습니다.
> Exactly-once는 Kafka Streams 의존성과 외부 DB 원자성 보장 불가 때문에 배제했고,
> At-least-once + 멱등성으로 실질적 Exactly-once를 달성했습니다.
> Consumer Lag 모니터링은 Grafana 대시보드로 파티션별 추적합니다."

**연결 문서**
- [ADR-001: Kafka vs RabbitMQ](docs/adr/ADR-001-kafka-vs-rabbitmq.md)
- [ADR-001 면접 Q&A](docs/interview-prep/ADR-001-interview-questions.md)
- [depth-guide §5: Kafka](docs/interview-prep/depth-guide.md#5-분산-시스템--kafka)
- [Episode #4: MQ 에러 복구](EXPERIENCE-STORIES.md)

---

### Track 3: 캐시 & Stampede 방지

> "캐시는 쉽다. 캐시 만료 순간이 어렵다."

**실무 문제**
배치 처리 후 캐시가 동시에 만료되면서 수백 개 요청이 동시에 DB로 몰림 (Cache Stampede).
L1(인메모리) + L2(Redis) 2계층 캐시 운영 경험.

**당해보기 실험**
```
실험 1: 캐시 없이 동일 API에 1000 RPS 부하
  → 측정: DB 커넥션 수, TPS, P99

실험 2: @Cacheable(TTL=60s)만 적용
  → 측정: TTL 만료 직후 순간 DB 커넥션 수 (Stampede 발생)

실험 3: @Cacheable + 분산 락 (Double-Check Locking)
  → 측정: TTL 만료 직후에도 DB 요청 1건만 발생하는지 확인

실험 4: L1(Caffeine 5초) + L2(Redis 60초) 2계층
  → 측정: L1 히트율, L2 히트율, DB 도달 비율
```

**CS 딥다이브 체크리스트**
- [ ] Cache-Aside vs Write-Through vs Write-Behind — 각각 언제 쓰는가
- [ ] Cache Stampede: 왜 발생하는가, 방지법 3가지 (분산 락, PER, 영구 캐시)
- [ ] Double-Check Locking: 락 획득 후 다시 캐시 확인하는 이유
- [ ] Redis 클러스터 비동기 복제: 마스터 장애 시 캐시 유실 가능성
- [ ] Caffeine: W-TinyLFU 퇴거 알고리즘, ConcurrentHashMap 기반
- [ ] 캐시 일관성: `@TransactionalEventListener(AFTER_COMMIT)` 패턴 (토스 사례)
- [ ] "캐시가 오히려 해가 되는 경우는?" — Write-heavy, 일관성 필수 도메인

**구현 목표**
- platform-api: Caffeine(L1) + Redis(L2) 2계층 캐시
- Cache Stampede 방지: Redisson 분산 락 + Double-Check (Track 1 의존)
- 캐시 히트율/미스율 Micrometer 메트릭

**측정 기준 (Before/After)**

| 조건 | TPS | P99 | DB 커넥션 (피크) | 비고 |
|------|-----|-----|----------------|------|
| 캐시 없음 | 기준 | 기준 | 높음 | Before |
| @Cacheable만 | 높음 | 낮음 | TTL 만료 시 급등 | Stampede |
| + 분산 락 | 높음 | 낮음 | 안정 | Stampede 방지 |
| L1+L2 2계층 | 가장 높음 | 가장 낮음 | 최소 | After |

**면접 스토리**
> "실무에서 배치 후 캐시가 동시 만료되면서 DB 커넥션이 고갈되는 현상을 겪었습니다.
> 캐시 없이 → 단순 @Cacheable → TTL 만료 시 Stampede → 분산 락으로 해결 → L1+L2 2계층까지.
> 각 단계의 TPS와 DB 커넥션 수를 실측 비교했고,
> 최종적으로 Caffeine(L1, 5초) + Redis(L2, 60초) + 분산 락 Stampede 방지를 선택했습니다.
> Cache-Aside를 선택한 이유는 Write-Through 대비 쓰기 레이턴시가 없고,
> 캐시 유실 시 DB에서 재로드할 수 있기 때문입니다."

**연결 문서**
- [ADR-003: Cache 전략](docs/adr/ADR-003-cache-strategy.md)
- [depth-guide §6: 캐시](docs/interview-prep/depth-guide.md#6-분산-시스템--캐시)
- [Episode #6: 2계층 캐시](EXPERIENCE-STORIES.md)

---

### Track 4: 장애 격리 & 복원력

> "외부 API가 3초 timeout이면, 우리 서비스도 3초가 된다. Circuit Breaker가 없으면."

**실무 문제**
외부 플랫폼 API 장애가 폭증하면서 전체 서비스가 연쇄 실패. (cmong-scraper)
스레드 풀이 모두 외부 API 대기에 점유되어 정상 요청도 처리 불가.

**당해보기 실험**
```
실험 1: 외부 API를 WireMock으로 시뮬레이션 — 3초 지연 응답 설정
  → Circuit Breaker 없이 100 RPS 부하
  → 측정: 전체 서비스 P99, 스레드 풀 active 수, 정상 API의 응답시간 (전파 확인)

실험 2: Resilience4j CircuitBreaker 적용 (failureRateThreshold=50)
  → 50% 이상 실패 시 Open → Fallback 응답
  → 측정: Open 전환 시점, Fallback 응답시간, 정상 API 응답시간 (격리 확인)

실험 3: CircuitBreaker + Bulkhead (스레드 풀 격리)
  → 외부 API 전용 스레드 풀 10개로 제한
  → 측정: 외부 API 장애 시에도 내부 API 스레드 풀은 정상인지 확인

실험 4: Half-Open 상태에서 점진적 복구
  → 외부 API 장애 복구 후, CircuitBreaker가 자동으로 Closed 전환
  → 측정: 복구 소요 시간, 허용 요청 비율
```

**CS 딥다이브 체크리스트**
- [ ] Circuit Breaker 상태 머신: Closed → Open → Half-Open
- [ ] 설정값 근거: failureRateThreshold, waitDurationInOpenState, permittedNumberOfCallsInHalfOpenState
- [ ] Bulkhead: 스레드 풀 격리 vs 세마포어 격리
- [ ] Timeout 전파: 외부 timeout이 내부 서비스에 미치는 영향
- [ ] Rate Limiting: Token Bucket vs Leaky Bucket vs Fixed Window
- [ ] Retry: 지수 백오프, 최대 재시도, 멱등성 보장 시에만 Retry
- [ ] 토스의 이중 Circuit Breaker: Istio(인프라) + Resilience4j(앱) 조합

**구현 목표**
- platform-api: Resilience4j CircuitBreaker + Retry + RateLimiter + Bulkhead
- WireMock 기반 장애 시뮬레이션 테스트
- CircuitBreaker 상태 전환 메트릭 → Grafana

**측정 기준 (Before/After)**

| 조건 | 외부 API P99 | 내부 API P99 | 스레드 풀 사용률 | 비고 |
|------|-------------|-------------|----------------|------|
| CB 없음 + 외부 장애 | 3000ms+ | 3000ms+ (전파) | 100% (고갈) | Before |
| CB 있음 + 외부 장애 | Open→Fallback | 50ms (정상) | 여유 | After |
| CB + Bulkhead | Fallback | 50ms | 격리 확인 | 최종 |

**면접 스토리**
> "실무에서 외부 플랫폼 장애가 폭증하면서 전체 서비스가 먹통이 된 적이 있습니다.
> 원인은 스레드 풀이 모두 외부 API timeout 대기에 점유된 것이었습니다.
> Circuit Breaker 없이 장애가 전파되는 것을 실험으로 재현했고,
> Resilience4j 도입 후 P99가 3초에서 50ms로 개선되는 것을 실측했습니다.
> failureRateThreshold=50은 실험에서 30~70 범위를 비교해 결정했고,
> 너무 민감하면 정상 트래픽도 차단되는 트레이드오프를 확인했습니다."

**연결 문서**
- [depth-guide §5: 분산 시스템](docs/interview-prep/depth-guide.md) (Circuit Breaker 섹션 추가 필요)
- [Episode #5: 서킷 브레이커](EXPERIENCE-STORIES.md)

---

### Track 5: 이벤트 드리븐 & Outbox

> "DB에 저장했는데 이벤트가 안 나간다 — 이게 분산 시스템의 핵심 문제다."

**실무 문제**
DB 저장 후 Kafka 발행 전에 크래시가 나면 이벤트가 유실된다.
"DB 저장과 이벤트 발행을 원자적으로 할 수 있는가?" — 이게 Transactional Outbox의 출발점.

**당해보기 실험**
```
실험 1: DB 저장 후 직접 kafkaTemplate.send() 호출
  → 발행 직전에 RuntimeException 주입
  → 측정: DB에는 저장됨, Kafka에는 메시지 없음 (유실 증명)

실험 2: 같은 코드에서 @Transactional로 묶기 시도
  → 기대: Kafka는 DB 트랜잭션에 참여 못함 (2PC가 아닌 이상)
  → 측정: 동일하게 유실 발생

실험 3: Transactional Outbox 적용
  → DB 저장 + Outbox 테이블 저장 (같은 트랜잭션)
  → Relay가 폴링 → Kafka 발행
  → 측정: 크래시 시뮬레이션에도 최종적으로 메시지 발행 확인

실험 4: Relay 다중 인스턴스 경합
  → 2개 Relay가 동시에 Outbox 폴링
  → SELECT FOR UPDATE SKIP LOCKED로 중복 발행 방지 확인
```

**CS 딥다이브 체크리스트**
- [ ] 2PC (Two-Phase Commit): 왜 분산 환경에서 성능/가용성 문제가 되는가
- [ ] Transactional Outbox Pattern: 같은 DB 트랜잭션으로 원자성 보장
- [ ] Outbox Relay: 폴링 (SELECT FOR UPDATE SKIP LOCKED) vs CDC (Debezium)
- [ ] CDC (Change Data Capture): Debezium의 동작 원리, binlog 기반
- [ ] Eventual Consistency: 강한 일관성 vs 최종 일관성 트레이드오프
- [ ] SAGA 패턴: Choreography vs Orchestration, 보상 트랜잭션
- [ ] 우아한형제들의 3계층 이벤트: ApplicationEvent / SNS-SQS / Zero-Payload
- [ ] "왜 CDC가 아니라 폴링인가?" — 인프라 복잡도 트레이드오프

**구현 목표**
- platform-api: Outbox 테이블 + OutboxRelay (스케줄러 기반 폴링)
- platform-event-consumer: Outbox에서 발행된 이벤트 소비
- 크래시 복구 테스트: "DB 저장 후 서버 크래시 → Relay 재시작 → 메시지 최종 발행"

**측정 기준 (Before/After)**

| 조건 | 메시지 유실 | 발행 지연 | 구현 복잡도 | 비고 |
|------|-----------|---------|-----------|------|
| 직접 kafkaTemplate.send() | 유실 가능 | 즉시 | 낮음 | Before |
| Transactional Outbox + 폴링 | 유실 없음 | 폴링 주기 (5초) | 중간 | After |
| CDC (Debezium) | 유실 없음 | ms 단위 | 높음 (인프라) | 대안 비교 |

**면접 스토리**
> "DB에 저장했는데 Kafka 발행이 안 되는 상황을 실험으로 재현했습니다.
> @Transactional로 묶어도 Kafka는 DB 트랜잭션에 참여하지 않아서 유실이 발생했고,
> Transactional Outbox Pattern으로 해결했습니다.
> CDC(Debezium) 대신 폴링을 선택한 이유는 인프라 복잡도 대비 5초 지연이 우리 도메인에서 허용 가능했기 때문이고,
> 이 판단 기준은 ADR-005에 기록했습니다.
> Relay 다중 인스턴스 경합은 SELECT FOR UPDATE SKIP LOCKED로 해결했습니다."

**연결 문서**
- [ADR-005: Outbox Relay 폴링 주기](docs/adr/ADR-005-outbox-relay.md)
- [depth-guide §8: MSA & 이벤트 드리븐](docs/interview-prep/depth-guide.md#8-시스템-설계--msa--이벤트-드리븐)
- [Episode #4: MQ 에러 복구](EXPERIENCE-STORIES.md)

---

## 프로젝트 ↔ 트랙 매핑

| 프로젝트 | 적용 트랙 | 핵심 구현 |
|---------|----------|---------|
| **platform-api** (Java) | Track 0, 1, 3, 4, 5 | 분산 락, 2계층 캐시, Circuit Breaker, Outbox |
| **platform-event-consumer** (Kotlin) | Track 0, 2, 5 | Manual Commit, Idempotent Consumer, DLQ |
| **async-crawler** (Kotlin) | Track 0, 4 | Structured Concurrency, Circuit Breaker, Rate Limiting |

프로젝트 상세 설계는 [projects/README.md](projects/README.md) 참고.
언어 선택 근거(Java + Kotlin 혼합)도 해당 문서에 기록.

---

## 기존 문서와의 관계

| 문서 | 역할 | 상태 |
|------|------|------|
| **STRATEGY.md** (이 문서) | 딥다이브 트랙 전략의 본체 | 현행 |
| [STRATEGY-V2.md](STRATEGY-V2.md) | 10개사 JD 분석 + 기술 블로그 깊이 분석. 참고 아카이브 | 아카이브 |
| [EXPERIENCE-STORIES.md](EXPERIENCE-STORIES.md) | 실무 경험 7개 에피소드. 트랙의 "실무 문제" 소스 | 유지 |
| [LEARNING-LOG.md](LEARNING-LOG.md) | 트랙별 실험 일지. "당해보기"의 기록 | 실험 형식으로 재구조화 |
| [FEEDBACK.md](FEEDBACK.md) | 초기 전략 갭 분석. 대부분 해결됨 | 아카이브 |
| [docs/adr/](docs/adr/) | 기술 결정 근거. 각 트랙에서 링크 | 유지 |
| [docs/interview-prep/depth-guide.md](docs/interview-prep/depth-guide.md) | 꼬리질문 4단계 방어. 트랙의 CS 딥다이브와 연결 | 유지 |

---

## ADR (Architecture Decision Records)

| ADR | 상태 | 연결 트랙 |
|-----|------|----------|
| [ADR-001: Kafka vs RabbitMQ](docs/adr/ADR-001-kafka-vs-rabbitmq.md) | 완료 | Track 2 |
| [ADR-002: Coroutines vs Virtual Threads](docs/adr/ADR-002-coroutines-vs-virtual-threads.md) | 완료 | Track 2, 4 |
| [ADR-003: Cache 전략](docs/adr/ADR-003-cache-strategy.md) | 완료 | Track 3 |
| [ADR-004: 분산 락 구현 방식](docs/adr/ADR-004-distributed-lock.md) | 완료 | Track 1 |
| [ADR-005: Outbox Relay 폴링 주기](docs/adr/ADR-005-outbox-relay.md) | 완료 | Track 5 |

---

## 커밋 컨벤션

```
feat(영역): 무엇을 했는가

- 왜 이렇게 했는가 (배경)
- 이전 방식의 문제
- 이 방식으로 변경 후 달라진 점

Closes #이슈번호
```

---

## 주의사항

- **회사 코드 노출 금지**: 실제 cmong-mq, cmong-be, cmong-scraper-js 코드는 절대 이 저장소에 포함하지 않음
- **회사 이름/도메인 노출 금지**: 커밋 메시지, 코드 주석, 문서에 회사명 기재 금지
- **수치는 실측값만**: 측정하지 않은 수치를 기재하지 않음. 예상치는 "예상: X" 표기
- **ADR은 기술적 이유만**: "빅테크에서 많이 쓰니까" 같은 외부 동기는 포함하지 않음

---

_이 문서는 포트폴리오 진행에 따라 지속적으로 업데이트한다._
_마지막 업데이트: 2026-04-14 (F-Lab 딥다이브 트랙 철학 기반 전면 개정)_
