# 포트폴리오 프로젝트 목록

> **아카이브 (2026-04-14):**
> 이 문서는 초기 3-서비스 구조(platform-api, platform-event-consumer, async-crawler) 기준으로 작성되었다.
> 현재는 **3-Repo 독립 포트폴리오 구조**로 전환됨. 최신 구조는 [STRATEGY.md](../STRATEGY.md)의 "Repo 구조" 섹션 참고.
>
> | 현재 Repo | 트랙 | 도메인 |
> |----------|------|--------|
> | `concurrency-cache-lab` | Track 1+3 | 쿠폰/재고 동시성 |
> | `kafka-outbox-pipeline` | Track 2+5 | 주문 이벤트 파이프라인 |
> | `resilience-patterns-lab` | Track 4 | 외부 API 연동 |
>
> 아래 내용은 초기 서비스 설계 참고용으로 보존한다. 언어 선택 근거, 실무 문제 매핑은 여전히 유효.

각 프로젝트는 독립적인 GitHub 리포지토리로 공개한다.
회사 코드(TypeScript/Python)는 공개하지 않으며, **실제 운영에서 겪은 문제 패턴을 재설계한 것**임을 명시한다.

> **핵심 변경 (2026-04-06):**
> - 기존: 3개 프로젝트 전부 Kotlin
> - 변경: **Project 1은 Java**, Project 2-3은 Kotlin → "Java도 Spring도 코드 레벨에서 쓸 수 있다"를 증명
> - 근거: 10개사 JD 분석 결과 Java가 여전히 필수. Kotlin만으로는 "Java는 못 하는 사람" 리스크

---

## 전체 아키텍처

```
                        [platform-api] ★ Java 17+
                        ┌──────────────────────────────────────┐
  사용자 요청 ──────────▶│  Spring Boot 3.x + Java              │
                        │                                      │
                        │  [결제 도메인]                         │
                        │  ├─ @Transactional + REQUIRES_NEW    │
                        │  ├─ @Version 옵티미스틱 락            │
                        │  ├─ 멱등성 키 (IdempotencyKey)        │
                        │  └─ 쿠폰/구독/빌링 트랜잭션          │
                        │                                      │
                        │  [공통 인프라]                         │
                        │  ├─ Redisson 분산 락                  │
                        │  ├─ Caffeine(L1) + Redis(L2) 캐시    │
                        │  ├─ Transactional Outbox              │
                        │  └─ Resilience4j Circuit Breaker      │
                        └───────────┬──────────────────────────┘
                                    │ Kafka (Outbox Relay)
                                    ▼
                        [platform-event-consumer] ★ Kotlin
                        ┌──────────────────────────────────────┐
                        │  Spring Boot 3.x + Kotlin + Coroutine│
                        │                                      │
                        │  ├─ Idempotent Consumer               │
                        │  ├─ Dead Letter Topic                 │
                        │  ├─ Consumer Lag 모니터링             │
                        │  └─ 이벤트 기반 대시보드 집계         │
                        └──────────────────────────────────────┘

[async-crawler] ★ Kotlin Coroutine
  ┌─────────────────────────────┐
  │  Kotlin + Spring Batch      │
  │                             │
  │  ├─ Structured Concurrency  │──────▶  platform-api (결과 전달)
  │  ├─ Resilience4j 서킷 브레이커│
  │  ├─ Rate Limiting           │
  │  └─ Bloom Filter 중복 제거  │
  └─────────────────────────────┘
```

**언어 선택 근거:**

| 프로젝트 | 언어 | 이유 |
|---------|------|------|
| platform-api | **Java** | JD 교집합. "Java + Spring 코드 레벨" 증명. @Transactional 프록시, synchronized/Lock, CompletableFuture 등 Java 고유 패턴 사용 |
| platform-event-consumer | **Kotlin** | Kafka Consumer에서 Coroutine 활용. suspend 함수 기반 비동기 처리. 토스/당근/우아한 타겟 |
| async-crawler | **Kotlin** | Structured Concurrency로 수백 개 동시 외부 API 호출 관리. 서킷 브레이커 + Rate Limiting + Graceful Shutdown — 실무 분산 수집 시스템 패턴을 Kotlin으로 재설계 |

---

## 프로젝트 1: platform-api (Java)

**상태**: 계획 중 → Phase 0에서 스켈레톤 생성
**언어**: **Java 17+** + Spring Boot 3.x
**GitHub**: (예정)

### 연결된 실제 운영 문제 (EXPERIENCE-STORIES.md 참고)

| 실무 문제 (cmong-*) | 포트폴리오에서 재설계 | Episode |
|---------------------|---------------------|---------|
| QueryRunner 수동 트랜잭션 15개 블록 (cmong-be) | `@Transactional` + `REQUIRES_NEW` + `TransactionTemplate` | #1 |
| @VersionColumn 옵티미스틱 락 (cmong-be) | JPA `@Version` + `@Retryable` | #1 |
| 웹훅 멱등성 체크 (cmong-be) | `IdempotencyKey` 엔티티 + 유니크 제약 | #1 |
| Redis SET NX + Lua 분산 락 (cmong-be) | Redisson `tryLock` + watchdog | #2 |
| L1+L2 2계층 캐시 (cmong-be) | Caffeine(L1) + Redis(L2) + `@Cacheable` | #6 |
| 복합 인덱스 설계 (cmong-be) | JPA `@Index` + EXPLAIN ANALYZE 기록 | #3 |
| 사전 계산 대시보드 (cmong-be) | Spring `@Scheduled` + 배치 집계 | #3 |

### 핵심 기술 (Java 특화)

```
Java 동시성:
├─ synchronized vs ReentrantLock (벤치마크 포함)
├─ volatile + happens-before 관계 테스트
├─ ConcurrentHashMap 활용 (로컬 캐시)
├─ CompletableFuture 체이닝 (외부 API 병렬 호출)
└─ Virtual Thread (Java 21) — 선택적

Spring 내부 동작:
├─ @Transactional 프록시 — self-invocation 문제 테스트로 검증
├─ @Transactional(propagation = REQUIRES_NEW) — 부분 롤백
├─ TransactionTemplate — 프로그래매틱 트랜잭션 (QueryRunner 대응)
├─ AOP 프록시 — CGLIB vs JDK Dynamic Proxy 확인
└─ Bean Lifecycle — @PostConstruct, @PreDestroy, SmartLifecycle

JPA/Hibernate:
├─ @Version 옵티미스틱 락 + 재시도
├─ 복합 인덱스 @Index + EXPLAIN ANALYZE
├─ N+1 문제 인지 + fetch join / EntityGraph 해결
├─ 영속성 컨텍스트 1차 캐시 동작 확인
└─ Querydsl 또는 JPQL로 복잡 쿼리

분산 시스템:
├─ Redisson 분산 락 (watchdog 자동 연장)
├─ Resilience4j CircuitBreaker + Retry + RateLimiter
├─ Transactional Outbox Pattern (outbox 테이블 + SELECT FOR UPDATE SKIP LOCKED)
├─ Caffeine + Redis 2계층 캐시 + Stampede 방지
└─ 멱등성 키 패턴
```

### 테스트 전략 (Java)

```
단위 테스트:
├─ JUnit 5 + AssertJ
├─ Mockito (외부 의존성 mock)
└─ 옵티미스틱 락 충돌 재현 테스트

통합 테스트:
├─ Testcontainers (MySQL + Redis + Kafka)
├─ @Transactional self-invocation 검증
├─ 동시성 테스트: ExecutorService 100 스레드
└─ EXPLAIN ANALYZE 결과 검증

부하 테스트:
├─ k6: P95 < 200ms, P99 < 500ms, 에러율 < 1%
├─ HikariCP 커넥션 풀 사이즈별 비교
└─ 캐시 히트/미스 시나리오별 TPS
```

### 폴더 구조 (예정)

```
platform-api/
├── src/main/java/com/portfolio/platform/
│   ├── payment/
│   │   ├── domain/          (Billing, Subscription, Coupon, IdempotencyKey)
│   │   ├── service/         (PaymentService, CouponService)
│   │   ├── repository/
│   │   └── api/             (PaymentController)
│   ├── dashboard/
│   │   ├── domain/          (BrandDashboardDaily)
│   │   ├── service/         (DashboardAggregationService)
│   │   └── batch/           (DailyAggregationJob)
│   ├── common/
│   │   ├── lock/            (DistributedLockService — Redisson)
│   │   ├── cache/           (TwoLayerCacheService — Caffeine+Redis)
│   │   ├── outbox/          (OutboxEntity, OutboxRelayService)
│   │   ├── resilience/      (CircuitBreaker 설정)
│   │   └── idempotency/     (IdempotencyKeyService)
│   └── config/
│       ├── RedisConfig.java
│       ├── CacheConfig.java
│       └── ResilienceConfig.java
├── src/test/java/com/portfolio/platform/
│   ├── payment/             (트랜잭션, 옵티미스틱 락, 멱등성 테스트)
│   ├── common/lock/         (분산 락 동시성 테스트)
│   ├── common/cache/        (2계층 캐시 + Stampede 테스트)
│   └── integration/         (Testcontainers 통합 테스트)
├── build.gradle.kts
├── docker-compose.yml       (로컬 개발용)
└── README.md                (실측 수치 + 아키텍처)
```

---

## 프로젝트 2: platform-event-consumer (Kotlin)

**상태**: 계획 중
**언어**: **Kotlin** + Spring Boot 3.x + Spring Kafka + Coroutine
**GitHub**: (예정)

### 연결된 실제 운영 문제

| 실무 문제 (cmong-*) | 포트폴리오에서 재설계 | Episode |
|---------------------|---------------------|---------|
| RabbitMQ persistent + prefetch=1 (cmong-be) | Kafka Manual Commit + AckMode | #4 |
| MqErrorLogs DLQ 패턴 (cmong-mq) | Kafka Dead Letter Topic | #4 |
| 4단계 에러 분류 (cmong-mq) | 에러 핸들러 + ErrorClassifier | #4 |
| EventEmitter2 이벤트 (cmong-be) | Transactional Outbox → Kafka | #4 |
| 임계값 기반 알림 (cmong-mq) | Consumer Lag 모니터링 + 알림 | #4 |

### 핵심 기술 (Kotlin 특화)

```
Kotlin Coroutine:
├─ suspend 함수 기반 메시지 처리
├─ withContext(Dispatchers.IO) — JPA 블로킹 격리
├─ SupervisorJob — 개별 메시지 실패 격리
└─ Flow<T> — 이벤트 스트림 처리

Spring Kafka:
├─ Manual Commit (AckMode.MANUAL_IMMEDIATE)
├─ Idempotent Consumer (processed_events 테이블)
├─ @RetryableTopic → Dead Letter Topic
├─ ErrorHandler + SeekToCurrentErrorHandler
└─ Consumer Lag Micrometer 메트릭

모니터링:
├─ Prometheus + Grafana 대시보드
├─ Consumer Lag → TPS 상관관계 실측
└─ 장애 주입: docker stop kafka → 복구 시간 측정
```

### 테스트 전략 (Kotlin)

```
단위 테스트:
├─ kotest + AssertJ (기존 kotest 기여 경험 활용)
├─ MockK (Kotlin 특화 mocking)
└─ 멱등성: 동일 메시지 3회 → DB 1건 검증

통합 테스트:
├─ Testcontainers (Kafka + MySQL)
├─ EmbeddedKafka 대안 비교
├─ Consumer rebalancing 시나리오
└─ DLT 최종 처리 검증
```

### 폴더 구조 (예정)

```
platform-event-consumer/
├── src/main/kotlin/com/portfolio/consumer/
│   ├── event/
│   │   ├── handler/         (ReviewEventHandler, OrderEventHandler)
│   │   ├── idempotency/     (ProcessedEventRepository)
│   │   └── dlt/             (DeadLetterHandler)
│   ├── aggregation/
│   │   ├── service/         (DashboardAggregationService)
│   │   └── domain/          (AggregationResult)
│   └── config/
│       ├── KafkaConsumerConfig.kt
│       └── MonitoringConfig.kt
├── src/test/kotlin/
│   ├── event/               (멱등성, DLT 테스트)
│   └── integration/         (Testcontainers Kafka)
└── build.gradle.kts
```

---

## 프로젝트 3: async-crawler (Kotlin) — 분산 외부 API 호출 시스템

**상태**: 계획 중 (Phase 2에서 구현)
**언어**: **Kotlin** + Spring Batch + Coroutine
**GitHub**: (예정)

> **이 프로젝트의 포지셔닝**: 실무에서 6개 외부 플랫폼 대상 분산 데이터 수집 시스템을 설계/운영한 경험을
> Kotlin Coroutine + Spring Batch로 재설계. 스크래핑 로직이 아닌 **분산 시스템 패턴**(서킷 브레이커,
> Rate Limiting, 리소스 풀, Graceful Shutdown)에 초점.

### 연결된 실제 운영 문제

| 실무 문제 | 분산 시스템 관점 | 포트폴리오에서 재설계 | Episode |
|----------|---------------|---------------------|---------|
| 스레드 풀 + Lock 동시성 제어 | 리소스 경합 + 상호 배제 | Kotlin Coroutine + Mutex | #4, #6 |
| 적응형 트래픽 제어 (3단계 서킷 브레이커) | 외부 의존성 장애 격리 | Resilience4j CircuitBreaker + RateLimiter | #5 |
| 계정별 순차 처리 (세션 직렬화) | 분산 큐 + 공정성 보장 | Coroutine + Semaphore per account | #6 |
| 에러 비율 임계값 알림 | 관측성 + 알림 파이프라인 | Micrometer 메트릭 + 알림 | #5 |
| Drain Mode + 좀비 프로세스 정리 | 무중단 배포 + 리소스 누수 방지 | SmartLifecycle + Drain Mode | #7 |

### 핵심 기술 (Kotlin Coroutine 특화)

```
Structured Concurrency:
├─ coroutineScope { } — 구조화된 동시성
├─ supervisorScope { } — 장애 격리
├─ async/await — 병렬 외부 API 호출
├─ Flow<T> — 데이터 스트림
└─ Semaphore — 계정별 동시성 제한

Spring Batch:
├─ Chunk 기반 처리 (Reader → Processor → Writer)
├─ Partitioned Step — 병렬 배치
├─ Retry + Skip Policy
└─ Job Repository (재시작 지원)

Resilience:
├─ Resilience4j CircuitBreaker (에러율 기반)
├─ Bucket4j Rate Limiting
├─ Bloom Filter (Redis) — 중복 URL 제거
└─ Graceful Shutdown (SmartLifecycle)
```

### 폴더 구조 (예정)

```
async-crawler/
├── src/main/kotlin/com/portfolio/crawler/
│   ├── crawl/
│   │   ├── service/         (CrawlOrchestrator — supervisorScope)
│   │   ├── client/          (PlatformClient — WebClient + CircuitBreaker)
│   │   └── dedup/           (BloomFilterService)
│   ├── batch/
│   │   ├── job/             (CrawlBatchJob — Spring Batch)
│   │   └── step/            (PartitionedCrawlStep)
│   ├── resilience/
│   │   ├── config/          (CircuitBreakerConfig, RateLimiterConfig)
│   │   └── monitor/         (ErrorRateMonitor)
│   └── config/
└── src/test/kotlin/
    ├── crawl/               (Coroutine 동시성 테스트)
    └── integration/         (서킷 브레이커 상태 전환 테스트)
```

---

## 공통 인프라

**폴더**: `./infra/`

```yaml
# docker-compose.yml 포함 서비스:
- Kafka (KRaft 모드, Zookeeper 없음) + Kafka UI
- Redis 7.2 (256MB, LRU eviction)
- MySQL 8.0 (3개 DB: api_server, event_pipeline, crawler_engine)
- Prometheus (Spring Actuator + Kafka JMX 메트릭 수집)
- Grafana (대시보드 — Consumer Lag, TPS, P99, GC)
- k6 (부하테스트 — --profile loadtest로 실행)
```

**실행**:
```bash
cd infra
docker-compose up -d
# Kafka UI: http://localhost:8989
# Grafana: http://localhost:3000 (admin/admin)
# Prometheus: http://localhost:9090
```

---

## 왜 Java + Kotlin 혼합인가? (면접 방어)

**Q: "왜 하나의 언어로 통일하지 않았나?"**

> 실무에서도 서비스 성격에 따라 최적의 언어가 다릅니다.
> 
> **platform-api (Java)**: 결제 도메인은 @Transactional 프록시, 동시성 제어(synchronized, Lock),
> CompletableFuture 등 Java의 동시성 기본기가 중요합니다. 또한 JPA/Hibernate와의 호환성이
> Kotlin보다 Java에서 더 자연스럽고, 팀에 Java 개발자가 많은 환경을 고려했습니다.
>
> **platform-event-consumer (Kotlin)**: 이벤트 처리는 suspend 함수 기반 비동기 처리가 적합하고,
> withContext(Dispatchers.IO)로 블로킹 I/O를 격리하는 Coroutine의 장점이 극대화됩니다.
>
> **async-crawler (Kotlin)**: 수백 개의 동시 외부 API 호출을 Structured Concurrency로 관리하고,
> SupervisorJob으로 개별 실패를 격리하는 것이 Thread 기반보다 자원 효율적입니다.
>
> 한마디로: "도구를 상황에 맞게 선택할 수 있다"를 보여주는 것이 목적입니다.

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2026-04-03 | 초안. 3개 프로젝트 전부 Kotlin |
| 2026-04-06 | **Project 1을 Java로 변경**. 10개사 JD 분석 + 실무 경험(EXPERIENCE-STORIES.md) 반영. Java 동시성/Spring 내부 동작/JPA 코드 포함. 면접 방어 섹션 추가 |
