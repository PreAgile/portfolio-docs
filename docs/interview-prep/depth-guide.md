# 면접 깊이 가이드 — 꼬리질문 3~4단계 방어

> **용도**: 각 기술 영역별로 면접관이 파고드는 방향과 방어 전략을 정리.
> **원칙**: "표면적 답변 → 원리 → 트레이드오프 → 실무 적용"의 4단계.
> **작성일**: 2026-04-06

---

## 사용법

각 주제는 다음 구조로 되어 있습니다:
```
[1단계] 기본 답변 — 이것만 답하면 주니어
[2단계] 원리 설명 — 3년차 합격선
[3단계] 트레이드오프 — 5년차 시니어
[4단계] 실무 적용 — "현업에서 고민해보지 않으면 답 못할" 수준
[실무 연결] 우리 프로젝트에서의 경험
[공부 자료] 이 주제를 깊이 공부하려면
```

---

## 1. DB — 트랜잭션 & 격리 수준

### ACID와 Isolation Level

**[1단계]** ACID는 Atomicity, Consistency, Isolation, Durability. 격리 수준은 4가지: READ UNCOMMITTED, READ COMMITTED, REPEATABLE READ, SERIALIZABLE.

**[2단계]** 각 격리 수준에서 발생하는 이상 현상:
- READ UNCOMMITTED: Dirty Read (커밋 안 된 데이터 읽음)
- READ COMMITTED: Non-Repeatable Read (같은 쿼리 다른 결과)
- REPEATABLE READ: Phantom Read (새로운 행이 나타남)
- SERIALIZABLE: 이상 현상 없음, 성능 최저

**[3단계]** MySQL의 REPEATABLE READ는 사실 Phantom Read가 발생하지 않는다.
- MVCC + 갭 락(Gap Lock)으로 새로운 행 삽입을 차단
- InnoDB의 read view는 트랜잭션 시작 시점의 스냅샷을 유지
- undo log를 통해 이전 버전의 데이터를 읽음

**[4단계]** 하지만 SELECT ... FOR UPDATE는 현재 데이터를 읽음 (current read).
- MVCC 스냅샷이 아니라 실제 최신 데이터를 잠금과 함께 읽음
- 따라서 REPEATABLE READ에서도 FOR UPDATE 쿼리는 다른 트랜잭션의 커밋을 볼 수 있음
- 이것이 "결제 처리에서 잔액 확인은 FOR UPDATE로 해야 한다"의 근거

**[실무 연결]** cmong-be에서 MySQL 기본 격리 수준(REPEATABLE READ)을 그대로 사용.
결제 처리에서 QueryRunner로 수동 트랜잭션을 관리하면서, 동시 결제 요청 시
옵티미스틱 락(@VersionColumn)으로 충돌을 감지.

**[공부 자료]**
- "Real MySQL 8.0" — 5장 트랜잭션과 잠금
- MySQL 공식 문서: InnoDB Locking and Transaction Model
- 블로그: "MySQL InnoDB MVCC 동작 원리" 검색

---

### 인덱스 내부 구조

**[1단계]** B+Tree 기반. 리프 노드에 데이터 포인터가 있고, 정렬되어 있어서 범위 검색에 유리.

**[2단계]**
- Clustered Index: 테이블 데이터 자체가 PK 순서로 물리적 정렬 (InnoDB는 PK가 클러스터드)
- Non-Clustered (Secondary) Index: 인덱스 리프에 PK 값을 저장 → PK로 다시 조회 (Random I/O)
- 커버링 인덱스: SELECT 컬럼이 모두 인덱스에 포함되면 테이블 접근 없이 응답 (EXPLAIN: Using index)

**[3단계]** 복합 인덱스 컬럼 순서 전략:
- 등호 조건(=) 컬럼을 앞에, 범위 조건(BETWEEN, >, <) 컬럼을 뒤에
- 범위 조건 이후의 컬럼은 인덱스를 활용하지 못함
- 카디널리티(고유값 수)가 높은 컬럼을 앞에 놓는 것이 일반적이지만, **쿼리 패턴이 더 중요**

**[4단계]** 인덱스가 오히려 성능을 해치는 케이스:
- 테이블의 20~30% 이상을 읽는 쿼리 → 옵티마이저가 풀스캔 선택
- INSERT/UPDATE/DELETE 시 인덱스 유지 비용 (Write 성능 하락)
- 인덱스가 많으면 옵티마이저가 잘못된 인덱스를 선택할 수 있음 (USE INDEX 힌트 필요)

**[실무 연결]** cmong-be에서 설계한 인덱스:
- `idx_user_platform_covering(user_id, platform_id, is_active, created_at)`: 커버링 인덱스
- `uq_brand_manager_platform_date(brand_id, org_manager_id, platform, date)`: 유니크 + 조회
- 쿼리 패턴: `WHERE brand_id = ? AND date BETWEEN ? AND ?` → brand_id(등호) 앞, date(범위) 뒤

**[공부 자료]**
- "Real MySQL 8.0" — 8장 인덱스
- EXPLAIN ANALYZE 실습 (platform-api에서 직접)
- 블로그: "카버링 인덱스의 효과" 검색

---

## 2. DB — 락 & 동시성

### Optimistic vs Pessimistic Lock

**[1단계]** 옵티미스틱: 충돌이 드물다고 가정, 커밋 시 버전 확인. 페시미스틱: 충돌이 잦다고 가정, 읽을 때부터 잠금.

**[2단계]**
- 옵티미스틱: `@Version` 컬럼으로 구현. UPDATE ... WHERE version = ? → 0 rows updated면 충돌
- 페시미스틱: `SELECT ... FOR UPDATE` → 다른 트랜잭션은 대기
- 옵티미스틱은 DB 락을 잡지 않아서 동시성이 높지만, 충돌 시 재시도 비용 발생

**[3단계]** 선택 기준:
- 읽기 많고 충돌 드물면 → 옵티미스틱 (대부분의 웹 서비스)
- 충돌이 자주 발생하면 → 페시미스틱 (재고 차감, 좌석 예약)
- 분산 환경에서는 DB 락으로 충분하지 않을 수 있음 → Redis 분산 락 필요

**[4단계]** 데드락 시나리오:
- Transaction A: row 1 잠금 → row 2 잠금 시도
- Transaction B: row 2 잠금 → row 1 잠금 시도
- InnoDB 데드락 탐지: wait-for graph로 순환 감지 → 비용 낮은 트랜잭션 롤백
- `SHOW ENGINE INNODB STATUS`로 데드락 로그 확인

**[실무 연결]**
- cmong-be: `@VersionColumn` 옵티미스틱 락 (플랫폼 계정 메타데이터)
- cmong-be: Redis SET NX 분산 락 (크론잡 중복 방지)
- cmong-be: 결제에서는 페시미스틱 락 미사용 — 웹훅 멱등성으로 대체

**[공부 자료]**
- "Real MySQL 8.0" — 5장 (InnoDB 잠금)
- JPA @Version + @Lock 실습
- 데드락 재현 실습: 2개 터미널에서 교차 UPDATE

---

## 3. Java/JVM — GC & 메모리

### GC 알고리즘

**[1단계]** Young(Eden+Survivor) → Old 구조. Minor GC(Young), Major/Full GC(Old).

**[2단계]** 주요 GC 알고리즘:
- G1GC (Java 9+ 기본): Region 기반, Mixed GC로 Old 영역 점진적 수집
- ZGC (Java 15+): Colored Pointer, STW 10ms 이하, 대용량 힙에 적합
- Shenandoah: ZGC와 유사하지만 다른 접근 (Brooks Pointer)

**[3단계]** G1GC 동작 상세:
1. Young GC: Eden → Survivor로 복사 (STW)
2. Concurrent Marking: Old 영역에서 참조 추적 (애플리케이션과 동시)
3. Mixed GC: 가비지 비율 높은 Region 우선 수집 (Garbage First의 의미)
4. `-XX:MaxGCPauseMillis=200`: 목표 정지 시간. GC가 이를 맞추려고 Region 수 조절

**[4단계]** GC 튜닝 시나리오:
- 문제: Full GC 발생으로 수 초간 응답 불가
- 진단: `jstat -gcutil` → Old 영역 사용률 90% 이상 확인
- 원인: 메모리 누수 or 힙 크기 부족
- 대응: `-Xlog:gc*:file=gc.log` → GC 로그 분석 → MAT로 힙 덤프 분석
- ZGC 전환 시: STW 줄지만 처리량(throughput) 감소 가능 → 벤치마크 필수

**[실무 연결]** 직접 JVM 튜닝 경험은 없으나, Node.js의 V8 GC와 비교해서 이해:
- V8: Generational + Incremental Marking (유사 패턴)
- NestJS에서 메모리 누수 추적한 경험 → Java에서는 MAT, JFR 사용

**[공부 자료]**
- "자바 성능 튜닝 이야기" (이상민)
- `-XX:+UseG1GC` vs `-XX:+UseZGC` 벤치마크 실습
- `jstat -gcutil`, `jmap -dump`, MAT 실습
- Async-Profiler flame graph 생성 실습

---

### Java 동시성

**[1단계]** synchronized, volatile, ConcurrentHashMap.

**[2단계]**
- synchronized: 모니터 락. intrinsic lock. 메서드/블록 레벨
- ReentrantLock: 명시적 락. tryLock(timeout), 공정 락(fair) 지원
- volatile: 메모리 가시성 보장. happens-before 관계 설정

**[3단계]** ConcurrentHashMap Java 8 변경:
- Java 7: Segment 기반 분할 잠금 (16 세그먼트)
- Java 8: 노드 단위 CAS(Compare-And-Swap) + synchronized
  - 빈 버킷 → CAS로 삽입 (락 없음)
  - 충돌 → 해당 노드만 synchronized
  - 8개 이상 충돌 + capacity 64 이상 → Red-Black Tree 전환

**[4단계]** volatile과 DCL(Double-Checked Locking):
```java
// volatile 없으면 깨지는 이유:
private static volatile Singleton instance;
if (instance == null) {           // 1. check
    synchronized (lock) {
        if (instance == null) {   // 2. double-check
            instance = new Singleton(); // 3. 초기화
        }
    }
}
// volatile 없으면 instruction reordering으로
// 다른 스레드가 초기화 안 된 인스턴스를 볼 수 있음
```

**[실무 연결]**
- cmong-mq: threading.Lock() + queue.Queue() (Python 동시성)
- cmong-scraper: async-mutex, SessionLockRegistry (FIFO/PRIORITY)
- cmong-be: Redis SET NX + Lua (분산 환경 동시성)
- 이 경험들을 Java synchronized/ReentrantLock 관점으로 변환 가능

**[공부 자료]**
- "자바 병렬 프로그래밍" (Brian Goetz)
- ConcurrentHashMap Java 8 소스 분석
- CompletableFuture 체이닝 코드 작성

---

## 4. Spring — 내부 동작

### @Transactional 프록시

**[1단계]** 메서드에 @Transactional 붙이면 트랜잭션이 관리된다.

**[2단계]** 동작 원리: Spring AOP가 프록시를 생성.
- CGLIB (기본): 대상 클래스의 서브클래스를 런타임에 생성
- JDK Dynamic Proxy: 인터페이스가 있을 때 사용 가능
- 프록시가 메서드 호출을 가로채서 → 트랜잭션 시작 → 비즈니스 로직 → 커밋/롤백

**[3단계]** self-invocation 문제:
```java
@Service
public class PaymentService {
    @Transactional
    public void pay() {
        // ...
        this.applyCoupon(); // ← 프록시를 거치지 않음!
    }

    @Transactional(propagation = REQUIRES_NEW)
    public void applyCoupon() {
        // 새 트랜잭션이 시작되지 않음
    }
}
```
해결: 별도 빈으로 분리하거나, `AopContext.currentProxy()` 사용

**[4단계]** 트랜잭션 전파 수준:
- REQUIRED (기본): 기존 트랜잭션 있으면 참여, 없으면 생성
- REQUIRES_NEW: 항상 새 트랜잭션. 기존 트랜잭션은 일시 중단
- NESTED: 기존 트랜잭션 내에서 세이브포인트 생성 (부분 롤백)
- "결제 + 쿠폰 적용"에서 쿠폰 실패 시 결제만 유지하려면 REQUIRES_NEW 사용

**[실무 연결]**
- cmong-be: QueryRunner 수동 트랜잭션 = Spring의 TransactionTemplate과 동일 패턴
- NestJS의 @Injectable + DI = Spring의 @Component + @Autowired
- NestJS의 Interceptor = Spring의 AOP

**[공부 자료]**
- Spring Framework 소스: `TransactionInterceptor.java`
- Spring 공식 문서: Transaction Management
- `@Transactional` self-invocation 테스트 코드 직접 작성

---

### Bean 라이프사이클

**[1단계]** @Component로 등록, @Autowired로 주입.

**[2단계]** 전체 라이프사이클:
1. Bean Definition 로딩 (XML/Annotation 스캔)
2. 인스턴스 생성 (Constructor Injection)
3. 의존성 주입 (Setter/Field Injection)
4. @PostConstruct
5. InitializingBean.afterPropertiesSet()
6. 사용
7. @PreDestroy
8. DisposableBean.destroy()

**[3단계]** Scope:
- Singleton (기본): 컨테이너당 1개. 대부분의 서비스
- Prototype: 요청마다 새 인스턴스. 상태를 가진 빈
- Request: HTTP 요청마다 1개 (Web Scope)
- 주의: Singleton 빈이 Prototype 빈을 주입받으면, Prototype이 사실상 Singleton으로 동작

**[4단계]** 순환 참조:
- A → B → A: Spring이 감지하고 예외 (Spring Boot 2.6+부터 기본 금지)
- 해결: @Lazy, Setter Injection, 또는 설계 변경 (인터페이스 분리)

**[실무 연결]**
- cmong-be (NestJS): @Module + @Injectable = Spring의 @Configuration + @Component
- cmong-scraper: Request-scoped 서비스 (Scope.REQUEST) = Spring의 @RequestScope
- cmong-be: onApplicationShutdown() = Spring의 @PreDestroy

---

## 5. 분산 시스템 — Kafka

### Kafka 기본 + 심화

**[1단계]** Topic → Partition → Consumer Group. 생산자가 메시지를 보내고 소비자가 읽음.

**[2단계]**
- Partition: 순서 보장의 단위. 같은 키는 같은 파티션
- Consumer Group: 파티션을 소비자에게 분배. 1 파티션 = 1 소비자
- Offset: 소비자가 어디까지 읽었는지. 커밋 방식이 메시지 보장 수준 결정

**[3단계]** 메시지 전달 보장:
- At-most-once: 자동 커밋. 처리 전 커밋 → 유실 가능
- At-least-once: 수동 커밋. 처리 후 커밋 → 중복 가능 → 멱등 컨슈머 필요
- Exactly-once: Kafka Streams / Transactional Producer + Consumer
  - `enable.idempotence=true` + `isolation.level=read_committed`
  - 하지만 Kafka → 외부 시스템(DB)은 Exactly-once 보장 불가 → 멱등 컨슈머로 해결

**[4단계]** Consumer Lag 폭증 시 대응:
1. 모니터링: Grafana + Kafka Exporter로 파티션별 Lag 추적
2. 원인 분석: 소비자 처리 속도 감소? 생산량 급증? 리밸런싱?
3. 단기 대응: 소비자 인스턴스 추가 (파티션 수 이내)
4. 중기 대응: `max.poll.records` 조정, 처리 로직 최적화
5. 장기 대응: 파티션 수 증가 (단, 순서 보장 영향 주의)

**[실무 연결]**
- cmong-be: RabbitMQ에서 persistent 메시지 + prefetch=1 = Kafka의 수동 커밋
- cmong-mq: DLQ 패턴 = Kafka의 Dead Letter Topic
- ADR-001: RabbitMQ → Kafka 전환 근거 상세 분석
- ADR-001 면접 Q&A: 파티션 키 선택, 리밸런싱, Consumer Lag 대응

**[공부 자료]**
- "카프카 핵심 가이드" (네하 나크해데)
- Spring Kafka 공식 문서
- Testcontainers + Spring Kafka 통합 테스트 실습

---

## 6. 분산 시스템 — 캐시

### Cache-Aside + Stampede

**[1단계]** Cache-Aside: 읽기 시 캐시 확인 → 미스 시 DB 조회 → 캐시 저장.

**[2단계]** Cache Stampede: 인기 키의 TTL이 만료되면 동시에 수백 개 요청이 DB로.
- 방지법 1: 분산 락 (하나의 요청만 DB 조회, 나머지 대기)
- 방지법 2: Probabilistic Early Expiration (TTL 만료 전 확률적으로 갱신)
- 방지법 3: 영구 캐시 + 백그라운드 갱신 (stale-while-revalidate)

**[3단계]** Cache-Aside vs Write-Through vs Write-Behind:
- Cache-Aside: 가장 일반적. 읽기 최적화. 쓰기 시 캐시만 삭제
- Write-Through: 쓰기 시 캐시+DB 동시 갱신. 쓰기 레이턴시 증가
- Write-Behind: 쓰기 시 캐시만 갱신, 비동기로 DB 반영. 데이터 유실 위험

**[4단계]** Redis 클러스터 환경에서의 캐시 일관성:
- 비동기 복제: 마스터 쓰기 → 슬레이브 복제 전 마스터 죽음 → 데이터 유실
- 해결: `WAIT` 명령으로 동기 복제 강제 (성능 트레이드오프)
- 실무: 캐시 데이터는 유실되어도 DB에서 재로드 가능하므로 비동기 복제 허용

**[실무 연결]**
- cmong-be/scraper: L1(In-Memory 5분) + L2(Redis 24시간) 2계층 캐시
- cmong-be: 이벤트 기반 캐시 무효화 (EventEmitter2 → 캐시 삭제)
- cmong-ml: Cache-First + 프리픽스 기반 벌크 삭제
- ADR-003: Cache-Aside + 분산 락 (Stampede 방지) 결정 근거

---

## 7. 시스템 설계 — 결제

### 결제 시스템 핵심 패턴

**[1단계]** 결제 요청 → PG사 호출 → 결과 처리.

**[2단계]** 멱등성 보장:
- 멱등성 키 (Idempotency Key): 클라이언트가 고유 키를 전송
- 같은 키로 재요청 → 이전 결과 반환 (중복 결제 방지)
- DB에 키 저장 + 유니크 제약조건

**[3단계]** 결제 상태 머신:
```
INITIATED → PROCESSING → COMPLETED / FAILED / CANCELLED
                          ↓
                     REFUND_REQUESTED → REFUNDED
```
- 각 상태 전환에 조건 검사 (잘못된 전환 방지)
- 상태 전환 이벤트 발행 → 후속 처리 (알림, 정산, 감사 로그)

**[4단계]** 정산 배치:
- 일/주/월 단위 정산 집계
- 정산 금액 = 결제 금액 - 수수료 - 환불 금액
- 대량 데이터 처리: Spring Batch + 파티셔닝
- 정합성 검증: PG사 정산 데이터와 자체 데이터 대조

**[실무 연결]**
- cmong-be: Portone PG 연동 + 웹훅 기반 결제 확인
- cmong-be: 구독/빌링/쿠폰 트랜잭션 (15개 블록)
- cmong-be: 웹훅 멱등성 (merchant_uid+status+imp_uid 중복 체크)
- 보강 필요: 정식 멱등성 키, 정산 배치, 상태 머신 패턴

---

## 8. 시스템 설계 — MSA & 이벤트 드리븐

### SAGA 패턴

**[1단계]** 분산 환경에서 트랜잭션을 관리하는 패턴.

**[2단계]** 두 가지 방식:
- Choreography: 각 서비스가 이벤트를 발행하고 반응 (탈중앙)
- Orchestration: 중앙 오케스트레이터가 순서 제어

**[3단계]** 보상 트랜잭션:
```
주문 생성 → 결제 요청 → 재고 차감 → 배송 생성
                ↓ (실패)
주문 취소 ← 결제 취소 ← 재고 복원 (보상 트랜잭션)
```
- 보상 트랜잭션은 "원래 상태로 되돌리는 것"이 아닌 "보상 행위"
- 결제 취소는 새로운 결제 취소 트랜잭션 (원래 결제를 삭제하는 게 아님)

**[4단계]** Transactional Outbox Pattern:
- 문제: 비즈니스 로직 DB 저장 + 이벤트 발행을 원자적으로 해야 함
- 해결: Outbox 테이블에 이벤트를 같은 트랜잭션으로 저장 → 별도 Relay가 Kafka로 발행
- Relay 구현: 폴링 (SELECT FOR UPDATE SKIP LOCKED) 또는 CDC (Debezium)
- Relay 다중 인스턴스 경합: SKIP LOCKED로 메시지 중복 발행 방지

**[실무 연결]**
- cmong-be: EventEmitter2로 모놀리스 내 이벤트 드리븐 (SAGA의 전단계)
- cmong-be: 결제 완료 → 알림 → 캐시 무효화 (이벤트 체인)
- ADR-001: RabbitMQ → Kafka 전환 시 Outbox 패턴 적용 계획

---

## 9. 회사별 맞춤 준비 포인트

### 토스

| 주제 | 준비 깊이 | 에피소드 연결 |
|------|----------|-------------|
| Kotlin Coroutine | CPS 변환, Structured Concurrency, SupervisorJob | Episode 5, 7 |
| 결제 멱등성 | 멱등성 키 + 상태 머신 + 분산 락 | Episode 1 |
| 테스트 | Testcontainers, Fixture Monkey | platform-api 테스트 |
| 장애 대응 | 서킷 브레이커, 포스트모텀 | Episode 5 |

### 우아한형제들

| 주제 | 준비 깊이 | 에피소드 연결 |
|------|----------|-------------|
| DDD | Bounded Context, Aggregate, Domain Event | 포트폴리오 설계 |
| Spring Batch | Chunk, 파티셔닝, Zero-offset | Episode 3 |
| CQRS | 읽기/쓰기 모델 분리 | Episode 3 (대시보드) |
| 코드 리뷰 | SOLID, 클린 코드 | 포트폴리오 코드 품질 |

### 라인

| 주제 | 준비 깊이 | 에피소드 연결 |
|------|----------|-------------|
| JVM 심화 | GC 알고리즘, 메모리 모델, JIT | Phase 2 공부 |
| 분산 시스템 | CAP, 분산 락, Rate Limiting | Episode 2, 5 |
| Spring 내부 | IoC, AOP, @Transactional 프록시 | 오픈소스 분석 |
| 영어 | 기술 문서 읽기 + 회의 가능 | 일상 연습 |

### 쿠팡

| 주제 | 준비 깊이 | 에피소드 연결 |
|------|----------|-------------|
| 시스템 디자인 | 대규모 시스템 설계 면접 | Episode 3, 7 |
| DB 샤딩 | 샤드 키, 리밸런싱, 크로스샤드 | Episode 3 꼬리질문 |
| Bar Raiser | 리더십 원칙 기반 행동 면접 | 별도 준비 필요 |
| 알고리즘 | LeetCode Medium~Hard | 매일 1문제 |

### 네이버

| 주제 | 준비 깊이 | 에피소드 연결 |
|------|----------|-------------|
| CS 기초 | 4대 영역(자료구조, 알고리즘, OS, 네트워크) 골고루 | Phase 3 공부 |
| JVM | GC 튜닝 실습, 메모리 모델 | Phase 2 공부 |
| 대용량 트래픽 | Rate Limiting, Load Balancing | Episode 5 |
| GitHub 코드 | 실제 코드 리뷰 질문 대비 | 포트폴리오 코드 품질 |

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|----------|
| 2026-04-06 | 초안 작성. 9개 기술 영역 × 4단계 깊이 + 실무 연결 + 회사별 맞춤 |
