# 실무 경험 스토리북

> **용도**: 면접에서 말할 핵심 에피소드 7개. 각각 "문제→선택지→트레이드오프→결정→결과"로 구조화.
> **원칙**: 회사명/코드 노출 없이, 기술적 문제와 해결 과정만 기술.
> **작성일**: 2026-04-06

---

## 서비스 소개 — 면접 첫 설명용

### 30초 버전 (자기소개에서)
> "B2B SaaS 플랫폼에서 백엔드 엔지니어로 일하고 있습니다.
> 6개 외부 플랫폼의 리뷰·주문·매출 데이터를 실시간으로 수집하고 분석해서
> 기업 고객에게 대시보드로 제공하는 서비스입니다.
> 저는 **대규모 외부 데이터 수집 파이프라인의 분산 아키텍처 설계와 운영**을 메인으로 담당하고 있고,
> 결제/구독 시스템과 대용량 데이터 집계도 함께 맡고 있습니다."

### 왜 이 서비스가 기술적으로 어려운가 (면접관이 물으면)
> "외부 플랫폼에 초당 수백 건의 요청을 보내야 하는데, 우리가 통제할 수 없는 환경입니다.
> 플랫폼이 언제든 API 스펙을 바꾸거나 차단을 강화할 수 있고,
> 네트워크 장애, 세션 만료, Rate Limit 등이 수시로 발생합니다.
> 이런 환경에서 **고가용성과 장애 격리를 보장**하는 것이 핵심 과제입니다.
> PG사 연동이나 외부 마이크로서비스 호출에서 겪는 문제와 본질적으로 동일합니다."

### "그러면 스크래핑 아닌가요?" 방어

이 질문은 **반드시 나옵니다.** 준비된 답변:

> "네, 데이터 수집 방식 중 하나로 웹 스크래핑도 사용합니다.
> 하지만 제 역할에서 기술적으로 어려웠던 부분은 스크래핑 자체가 아니라
> **그것을 안정적으로 운영하기 위한 분산 시스템 설계**였습니다."

그 후 구체적으로:

> "예를 들어:
> - 30+ 인스턴스의 **리소스 풀 라이프사이클 관리** — DB 커넥션 풀과 같은 패턴
> - 에러율 기반 **3단계 서킷 브레이커** — Resilience4j와 동일한 상태 머신이지만 Redis로 분산
> - **가중치 기반 라우팅** — 성공률/지연/차단율 스코어링으로 자동 전환. Service Mesh LB와 동일
> - **Lease 기반 분산 큐** — 세션별 FIFO + TTL 자동 해제. 분산 락과 동일 패턴
> - **Graceful Shutdown** — 드레인 모드 + 인플라이트 완료 대기. K8s PreStop Hook과 동일
>
> 이 패턴들은 스크래핑에 특화된 게 아니라,
> **외부 의존성이 불안정한 모든 분산 시스템**에 적용되는 범용 패턴입니다."

### 왜 이 경험이 귀사에 도움이 되는가 (클로징)

| 회사 도메인 | 같은 패턴이 필요한 곳 |
|-----------|-------------------|
| 결제 (토스, 카카오페이, 라인페이) | PG사 API가 불안정할 때 서킷 브레이커 + Fallback PG 전환 |
| 배달 (우아한형제들) | 가게 API 장애 시 주문 서비스 격리 + 점진적 복구 |
| 커머스 (쿠팡) | 외부 셀러 API 연동에서 Rate Limit + 에러 분류 + 재시도 |
| 검색 (네이버) | 외부 데이터 소스 수집 파이프라인 안정성 |
| 금융 (라인페이) | 외부 은행 API 연동에서 장애 전파 차단 + 무중단 배포 |

---

## 읽는 법

각 에피소드는 다음 구조로 되어 있습니다:

```
[상황] 어떤 서비스에서 어떤 문제가 있었는가
[선택지] 어떤 대안들을 검토했는가
[트레이드오프] 각 선택지의 장단점
[결정] 무엇을 선택했고 왜
[구현 상세] 어떻게 구현했는가 (코드 수준)
[결과] 어떤 개선이 있었는가
[Java/Spring 대응] 같은 문제를 Java/Spring에서는 어떻게 해결하는가
[꼬리질문 방어] 면접관이 물어볼 수 있는 3~4단계 질문과 답변
```

---

## Episode 1: 결제 트랜잭션 정합성 — 다단계 트랜잭션 + 옵티미스틱 락

### 상황
리뷰 관리 SaaS 플랫폼에서 구독 결제를 처리하는 모듈. 하나의 결제 요청이 들어오면 다음 엔티티들이 **원자적으로** 업데이트되어야 한다:
- Subscription 상태 변경 (INACTIVE → ACTIVE)
- Billing 레코드 생성
- Coupon 사용 처리 (만료일 변경, 재사용 가능/불가능 분류)
- 기존 예약된(SCHEDULED) 구독 삭제
- 프로모션 가격 적용 (해당 시)

단일 엔티티 업데이트가 아니라 **5개 이상의 엔티티가 하나의 트랜잭션**에서 처리되어야 하고, 중간 단계 실패 시 **부분 롤백**이 필요한 케이스도 있었다.

### 선택지

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A. ORM 데코레이터 (@Transactional) | 서비스 메서드에 데코레이터 적용 | 코드 간결 | 중첩 트랜잭션 제어 불가, 부분 롤백 어려움 |
| B. 수동 QueryRunner | 트랜잭션 시작/커밋/롤백을 명시적으로 제어 | 세밀한 제어, 부분 롤백 가능 | 코드 복잡도 증가, 실수 가능 |
| C. SAGA 패턴 | 각 단계를 별도 트랜잭션으로 + 보상 트랜잭션 | 분산 시스템에 적합 | 현재 모놀리스에서 과도한 복잡도 |

### 트레이드오프
- A는 단순하지만 "쿠폰 적용 실패 시 빌링은 유지하고 쿠폰만 롤백" 같은 시나리오를 처리할 수 없다
- B는 15개 이상의 트랜잭션 블록을 직접 관리해야 하지만, 각 시나리오에 정확히 맞는 롤백이 가능
- C는 서비스가 모놀리스인 현재 시점에서 불필요한 복잡도

### 결정
**B. 수동 QueryRunner** — try-catch-finally 패턴으로 `connect → startTransaction → commitTransaction / rollbackTransaction → release`

### 구현 상세
```
결제 처리 흐름 (payment-db.service.ts):

1. queryRunner.connect()
2. queryRunner.startTransaction()
3. 기존 구독 조회 → 상태 변경
4. 예약된 구독 있으면 삭제
5. 쿠폰 검증 → categorizeUserCoupons()로 재사용/일회용 분류
6. 쿠폰 적용 → amountWithUserCoupons() 금액 계산
7. Billing 엔티티 생성
8. Subscription 엔티티 생성/업데이트
9. queryRunner.commitTransaction()
10. catch → queryRunner.rollbackTransaction()
11. finally → queryRunner.release()
```

추가로, 플랫폼 계정 메타데이터에 **@VersionColumn 옵티미스틱 락**을 적용:
- 동시 업데이트 시 `OptimisticLockVersionMismatchError` 발생
- 최대 2회 재시도 로직 (재시도 간 최신 데이터 다시 조회)
- 버전 비교 실패 시 마지막 쓰기 승리(last-write-wins) 방지

### 결과
- 15개 이상의 결제 시나리오(첫 결제, 업그레이드, 다운그레이드, 프로모션, 취소)를 정확히 처리
- 쿠폰 적용 실패 시 빌링만 유지하는 부분 롤백 정상 동작
- 옵티미스틱 락으로 동시 업데이트 충돌 감지 및 자동 재시도

### Java/Spring 대응
```
Spring에서의 동일 해결:
- @Transactional(propagation = Propagation.REQUIRES_NEW) → 부분 롤백
- @Version (JPA) → 옵티미스틱 락
- TransactionTemplate → 프로그래매틱 트랜잭션 제어 (QueryRunner 대응)
- @Retryable (Spring Retry) → 옵티미스틱 락 재시도
```

### 꼬리질문 방어

**Q1: "왜 ORM 데코레이터(@Transactional) 안 쓰고 수동으로?"**
> 구독 업그레이드에서 '기존 구독 비활성화 → 새 구독 생성 → 쿠폰 적용 → 빌링 생성' 순서인데,
> 쿠폰 적용에서 실패하면 빌링은 유지하고 쿠폰만 원복해야 하는 케이스가 있었습니다.
> 단일 @Transactional로는 이런 부분 롤백이 불가능합니다.

**Q2: "Spring에서는 @Transactional(propagation=REQUIRES_NEW)로 해결 가능한데, 알고 있나?"**
> 네, Spring에서는 내부 메서드를 별도 빈으로 분리하고 REQUIRES_NEW를 걸면
> 새 트랜잭션을 시작해서 독립적으로 커밋/롤백할 수 있습니다.
> 다만 self-invocation 문제가 있어서 반드시 다른 빈에서 호출해야 하고,
> 이는 Spring AOP가 프록시 기반이라 같은 클래스 내부 호출은 프록시를 거치지 않기 때문입니다.

**Q3: "옵티미스틱 락 재시도 2회로 정한 근거는?"**
> 해당 엔티티(플랫폼 계정 메타데이터)는 읽기가 압도적으로 많고 쓰기 충돌이 드문 패턴입니다.
> 실제 운영에서 충돌 발생 빈도를 모니터링한 결과 0.1% 미만이었고,
> 2회 재시도로 99.9% 이상 해소됐습니다. 3회 이상은 근본적인 동시성 문제 신호라
> 재시도보다 조사가 필요하다고 판단했습니다.

**Q4: "이 모놀리스가 MSA로 분리되면 어떻게 바꾸겠는가?"**
> 결제 서비스와 구독 서비스가 분리되면 단일 DB 트랜잭션이 불가능해지므로,
> SAGA 패턴(Choreography 방식)으로 전환합니다.
> 결제 완료 이벤트 발행 → 구독 서비스가 구독 활성화 → 실패 시 보상 트랜잭션(결제 취소).
> 이벤트 유실 방지를 위해 Transactional Outbox 패턴을 적용합니다.

---

## Episode 2: 분산 락으로 크론잡 중복 실행 방지

### 상황
다중 인스턴스(ECS 컨테이너 2~3개) 환경에서 크론잡이 동시에 실행되는 문제.
예: 매일 새벽 4시 파티셔닝 관리 크론, 매일 알림톡 발송 크론 등이 모든 인스턴스에서 중복 실행.

### 선택지

| 옵션 | 장점 | 단점 |
|------|------|------|
| A. DB 기반 락 (SELECT FOR UPDATE) | 추가 인프라 없음 | DB 부하, 데드락 위험, 해제 실패 시 복구 어려움 |
| B. Redis SET NX + TTL | 경량, 빠름, TTL로 자동 해제 | Redis 단일 노드 SPOF |
| C. Redisson 분산 락 | Watchdog 자동 연장, RedLock | 추가 의존성, 설정 복잡 |
| D. ZooKeeper | 강한 일관성 보장 | 인프라 오버헤드 과도 |

### 결정
**B. Redis SET NX + Lua 스크립트** — 이미 Redis 인프라가 있고, TTL 기반 자동 해제로 데드락 방지.

### 구현 상세
```
SafeCron 데코레이터 (210줄):

1. 크론 실행 시: redisService.setNX(lockKey, 'running', ttlSeconds=1800)
   - 키: safe_cron:{jobName}
   - 값: 'running'
   - TTL: 30분 (최대 실행 시간 기준)

2. 락 획득 실패 시: "다른 인스턴스에서 실행 중" 로그 후 스킵

3. 실행 완료 시: Lua 스크립트로 값 비교 후 삭제
   - DEL_IF_VALUE_MATCHES_LUA: GET → 값 비교 → DEL
   - 다른 인스턴스의 락을 잘못 해제하는 것 방지

4. Slack 알림:
   - 시작: 타임스탬프 + 잡 이름
   - 완료: 실행 시간
   - 실패: 에러 스택 트레이스
```

### 결과
- 다중 인스턴스에서 크론잡 중복 실행 0건
- TTL 30분으로 프로세스 크래시 시에도 자동 해제 (데드락 방지)
- Lua 스크립트로 원자적 해제 보장

### Java/Spring 대응
```
- ShedLock (@SchedulerLock): Spring 생태계 표준 솔루션
- Redisson (tryLock + watchdog): 자동 연장 지원
- Spring Integration: Redis Lock Registry
```

### 꼬리질문 방어

**Q1: "Redis 단일 노드가 죽으면?"**
> 현재 구조에서는 Redis 장애 시 모든 인스턴스가 락 획득에 실패하거나
> 모두 성공해서 중복 실행될 수 있습니다.
> 크리티컬하지 않은 크론(알림, 집계)은 중복 실행되어도 멱등하게 설계했고,
> 크리티컬한 작업은 DB 유니크 제약조건으로 2중 방어합니다.

**Q2: "Redlock 알고리즘은 알고 있나? 왜 안 썼나?"**
> Martin Kleppmann의 비판("Is Redlock safe?")을 포함해서 알고 있습니다.
> Redlock은 5개 노드 중 과반수 합의가 필요한데, 현재 Redis가 단일 노드라 적용 불가.
> 클러스터로 전환하더라도, 네트워크 지연이나 clock drift로 안전성이 보장되지 않는 한계가 있어서,
> 분산 락에만 의존하지 않고 비즈니스 로직 레벨에서 멱등성을 보장하는 것이 더 중요하다고 판단합니다.

**Q3: "TTL 30분인데, 작업이 30분 넘으면?"**
> 현재 크론잡 중 최장 시간이 약 15분이라 30분 TTL로 충분합니다.
> 만약 작업 시간이 불확실해지면 Redisson의 Watchdog 패턴(기본 30초마다 자동 연장)을 도입하거나,
> 작업 중간에 TTL을 갱신하는 heartbeat 방식을 적용합니다.

**Q4: "DB 락이 아니라 Redis 락을 선택한 이유?"**
> DB 락(SELECT FOR UPDATE)은 커넥션을 점유하고 있어야 해서 락 보유 시간만큼 커넥션 풀을 소모합니다.
> 크론잡이 15분 걸리면 15분간 커넥션 1개가 잠기는 셈이고, 피크 시간에 커넥션 풀 고갈 위험이 있습니다.
> Redis는 커넥션과 무관하게 키-값으로 관리되므로 이 문제가 없습니다.

---

## Episode 3: 수십만 Shop 대시보드 집계 최적화

### 상황
기업 고객용 대시보드에서 수십만 개 shop의 리뷰/주문/매출 데이터를 일별로 집계해서 보여줘야 함.
수천만 건의 리뷰 테이블에서 실시간으로 GROUP BY하면 **쿼리 응답시간 수십 초** → 사용 불가 수준.

### 선택지

| 옵션 | 장점 | 단점 |
|------|------|------|
| A. 실시간 쿼리 (GROUP BY) | 항상 최신 데이터 | 수천만 건 풀스캔, 응답시간 수십 초 |
| B. Materialized View | DB 레벨에서 자동 갱신 | MySQL 미지원 (PostgreSQL만), 수동 관리 필요 |
| C. 사전 계산 테이블 + 배치 | 조회 성능 극적 개선 | 데이터 지연 (배치 주기), 저장 공간 증가 |
| D. Elasticsearch | 집계 쿼리에 최적화 | 인프라 추가, 데이터 동기화 복잡도 |

### 결정
**C. 사전 계산 테이블(BrandDashboardDaily) + 복합 인덱스 + 기간별 캐시**

### 구현 상세
```
3단계 최적화:

1) 사전 계산 테이블
   - BrandDashboardDaily: 일별로 shop_count, order_count, review_count, sale_sum, reply_count 미리 계산
   - BrandDashboardDailyByManager: 매니저별 분리 (멀티테넌시)
   - 배치잡이 매일 새벽 집계 → INSERT/UPDATE

2) 복합 인덱스 설계
   - UNIQUE(brand_id, org_manager_id, platform, date): 중복 방지 + 조회 커버
   - INDEX(brand_id, org_manager_id, date): 날짜 범위 쿼리 최적화
   - INDEX(org_manager_id, platform, date): 매니저별 플랫폼 필터

3) 기간별 캐시 (V2)
   - BrandDashboardCachedV2: start_date ~ end_date + data_label(DAILY/WEEKLY/MONTHLY)
   - 같은 기간 요청 시 캐시 히트 → DB 쿼리 스킵
   - TTL 기반 만료 + 데이터 갱신 시 명시적 무효화

4) 쿼리 최적화
   - 플랫폼별 Map으로 그룹화 → IN 절로 한 번에 조회 (N+1 방지)
   - 날짜 범위 검색: WHERE date BETWEEN :start AND :end
   - KST → UTC 변환 유틸로 타임존 일관성 보장
```

### 결과
- 조회 응답시간: 수십 초 → 수백 ms 이내 (사전 계산 + 인덱스 + 캐시)
- 30일 이상 오래된 데이터는 아카이브 테이블로 분리 (archive_reviews, archive_shops)
- 날짜 기반 Range 파티셔닝 (naver_operation_logs: 7일 선생성, 30일 보관)

### Java/Spring 대응
```
- Spring Batch: chunk 기반 배치 처리 (JpaPagingItemReader + JpaItemWriter)
- @Scheduled + ShedLock: 배치잡 스케줄링 + 분산 락
- @Index (JPA): 복합 인덱스 선언
- Spring Cache (@Cacheable): 기간별 캐시
```

### 꼬리질문 방어

**Q1: "복합 인덱스 컬럼 순서를 어떻게 정했나?"**
> 쿼리 패턴을 분석했습니다. 대부분의 쿼리가 `brand_id = ? AND date BETWEEN ? AND ?`이므로
> brand_id를 첫 번째(등호 조건), date를 마지막(범위 조건)으로 설정했습니다.
> B+Tree에서 범위 조건이 나오면 그 이후 컬럼은 인덱스를 타지 못하므로 범위 컬럼이 마지막이어야 합니다.

**Q2: "커버링 인덱스는 적용했나?"**
> 네, `idx_user_platform_covering` 같은 인덱스는 SELECT에 필요한 컬럼까지 모두 포함해서
> 테이블 랜덤 I/O 없이 인덱스만으로 결과를 반환합니다.
> EXPLAIN에서 `Using index` 확인했습니다.

**Q3: "배치잡이 실패하면 어떻게 되나?"**
> 배치잡은 SafeCron(분산 락) + Slack 알림으로 관리됩니다.
> 실패 시 Slack에 에러 스택이 전송되고, 해당 날짜의 사전 계산이 누락되므로
> 이전 날짜 캐시가 계속 서빙됩니다 (stale but available).
> 다음 날 배치가 누락된 날짜까지 포함해서 재계산합니다.

**Q4: "데이터가 더 커져서 샤딩이 필요하면?"**
> 현재는 brand_id 기준으로 데이터가 분산되어 있으므로,
> brand_id를 샤드 키로 Range 샤딩을 적용합니다.
> 크로스샤드 쿼리(전체 브랜드 집계)는 각 샤드 결과를 애플리케이션 레벨에서 병합합니다.
> 더 나아가면 CQRS 패턴으로 읽기 모델을 분리하고, 이벤트로 Materialized View를 갱신합니다.

---

## Episode 4: MQ 기반 비동기 스크래핑 + 에러 복구 체계

### 상황
플랫폼별(배민, 쿠팡이츠, 네이버, 요기요 등) 리뷰/주문 데이터를 수집하는 파이프라인.
스크래핑은 외부 플랫폼 의존이라 실패가 잦고(네트워크, 세션 만료, 차단 등), 처리 시간도 불균일(1초~5분).

### 선택지

| 옵션 | 장점 | 단점 |
|------|------|------|
| A. 동기 처리 (HTTP 요청-응답) | 단순 | 5분 걸리는 작업에서 타임아웃, 스레드 점유 |
| B. RabbitMQ 비동기 | 메시지 지속성, 라우팅 유연 | 메시지 리플레이 불가, 컨슈머 재시작 시 유실 위험 |
| C. Kafka 비동기 | 리플레이, Consumer Group, 파티션 순서 | 인프라 복잡도 높음 |

### 결정
**B. RabbitMQ** (기존 인프라 활용) + **스레드 기반 병렬 처리** + **4단계 에러 분류 체계**

> 향후 Kafka 전환을 검토 중이며, 이미 ADR-001에서 상세 분석 완료

### 구현 상세
```
에러 분류 체계 (4단계 Severity):

1. SUCCESS — 정상 처리, 다음 작업 진행
2. RETRIABLE — 일시적 실패 (5xx, 타임아웃, 커넥션 에러) → 재시도 대상
3. CRITICAL — 영구 실패 (403, 비밀번호 오류, 세션 만료) → 즉시 비활성화
4. UNKNOWN — 분류 불가 → CRITICAL로 취급 (안전 우선)

에러 비율 임계값 알림:
- 리뷰: 플랫폼별 10~15% (BAEMIN 10%, CPEATS 15%)
- 주문: 70% (높은 임계값 — 외부 의존도 높음)
- 임계값 초과 시에만 Slack 알림 (알림 피로 방지)

DLQ 패턴:
- MqErrorLogs 테이블에 영구 실패 기록 (error_type, error_message, shop_id)
- isFinalFailureError()로 재시도 불가 에러 분류 ("이미 등록된 댓글", "만료된 리뷰 등")
- 재시도 가능 실패: failRepliesDetector가 주기적으로 탐지 → 재시도 큐에 재투입
```

### 결과
- 에러 분류 체계로 불필요한 재시도 제거 (CRITICAL 에러에 대한 무한 재시도 방지)
- 임계값 기반 알림으로 알림 피로 95% 감소
- 재시도 가능한 실패만 선택적으로 재처리 → 복구율 개선

### Java/Spring 대응
```
- Spring Kafka: Consumer Group + Manual Commit + ErrorHandler
- @RetryableTopic (Spring Kafka): 자동 재시도 + DLT
- Transactional Outbox: 이벤트 발행 보장
- Spring Retry: @Retryable + @Recover
```

### 꼬리질문 방어

**Q1: "RabbitMQ에서 Kafka로 전환하려는 이유?"**
> 3가지: 1) Consumer Group으로 여러 서비스가 같은 토픽을 독립적으로 소비 가능,
> 2) 메시지가 삭제되지 않아 리플레이 가능 (API 스펙 변경 시 재처리 필요했던 실제 사례),
> 3) 파티션 키(platform_account_id)로 같은 계정 메시지를 같은 컨슈머에 보장.

**Q2: "At-least-once에서 중복 처리는 어떻게 방지?"**
> 멱등 컨슈머 패턴을 적용합니다. 각 메시지에 고유 messageId를 부여하고,
> processed_events 테이블에서 처리 여부를 확인한 후 비즈니스 로직을 실행합니다.
> 이 확인과 비즈니스 로직을 **같은 DB 트랜잭션**에서 처리해야 원자성이 보장됩니다.

**Q3: "에러 비율 임계값이 플랫폼마다 다른 이유?"**
> 플랫폼마다 안정성이 다릅니다. CPEATS(쿠팡이츠)는 Akamai Bot Manager 때문에
> 정상 상황에서도 5~10% 실패가 발생하므로 임계값을 15%로 높였고,
> BAEMIN은 상대적으로 안정적이라 10%로 설정했습니다.
> 이 수치는 2주간 운영 데이터를 분석해서 "정상 범위의 상한선"으로 산출했습니다.

---

## Episode 5: 분산 트래픽 제어 시스템 — 서킷 브레이커 + 적응형 라우팅 + 리소스 풀

### 상황
6개 외부 플랫폼에 초당 수백 건의 API 요청을 보내는 분산 데이터 수집 시스템 운영.
외부 플랫폼이 갑작스럽게 요청 차단을 강화하면서 에러율이 95%까지 치솟음.
차단 상태에서 계속 요청을 보내면 IP 블랙리스트에 올라가고, 인프라 비용만 소모됨.
**핵심 과제: 외부 의존성이 불안정할 때 시스템을 어떻게 보호할 것인가.**

### 선택지

| 옵션 | 장점 | 단점 |
|------|------|------|
| A. 고정 Rate Limit | 구현 단순 | 상황 변화에 대응 불가 |
| B. 서킷 브레이커 (고정 임계값) | 장애 차단 | 점진적 복구 어려움 |
| C. 적응형 트래픽 제어 (서킷 브레이커 + 동적 임계값) | 상황에 따라 자동 조절 | 구현 복잡 |

### 결정
**C. 적응형 트래픽 제어** — 3단계 상태 머신 + 토큰 버킷 + Lua 스크립트 기반 원자적 리필

### 구현 상세 — 3개 서브시스템으로 분해

**서브시스템 A: 적응형 서킷 브레이커 (Adaptive Traffic Controller)**
```
3단계 상태 머신 (슬라이딩 윈도우 100건 기준):
- CLOSED (정상): 모든 요청 허용, effectiveMax = configMax
- SOFT_OPEN (경고): 기존 세션만 허용, 신규 차단. effectiveMax 동적 축소
- HALF_OPEN (반개방): 프로브 요청만 허용, 5회 연속 성공 시 CLOSED 복귀

전환 임계값 (운영 데이터 기반 산출):
- Severe: 에러율 50% → 쿨다운 30초 후 HALF_OPEN
- Moderate: 에러율 30% → SOFT_OPEN (용량 50% 감소)
- Mild: 에러율 15% → 경고 로그 (용량 70% 유지)
- 윈도우 TTL: 5분 (오래된 메트릭 자동 만료)

Token Bucket Rate Limiting (Redis Lua 스크립트):
- 원자적 연산: 토큰 잔량 확인 + 소비 + 리필을 단일 Lua 스크립트로
- 리필 속도: 10 tokens/sec (기본) → SOFT_OPEN: 5/sec → HALF_OPEN: 1/sec
- Fail-Open 정책: Redis 장애 시 요청 허용 (가용성 > 일관성)

핵심 설계 결정:
- Recovery Asymmetry: 감소는 즉시, 복구는 recoveryStep으로 점진적 → 안정성 우선
- Lazy Evaluation: 별도 타이머 없이 shouldAdmit() 호출 시 상태 평가 → 오버헤드 최소화
```

**서브시스템 B: 가중치 기반 라우팅 (Adaptive Proxy Routing)**
```
건강도 점수 계산식:
  Score = 100
       + (successRate × 35)           // 성공률 보상
       - (blockRate × 60)             // 차단 페널티 (가장 무거움)
       - min(avgLatencyMs / 200, 25)  // 지연 페널티 (최대 25점 캡)
       - min(consecutiveFailures × 8, 24)  // 연속 실패 (최대 24점)

  if (consecutiveFailures >= 3): score -= 1000  // 쿨다운: 사실상 제외

메트릭 저장: Redis Hash (TTL 15분)
  adaptive-proxy:stats:{platform}:{provider}:{type}:{host}:{port}
  → total, success, block, timeout, networkError, latencySum, consecutiveFailures

선택 알고리즘: 최고 점수 우선 (ties → 첫 번째)
Shadow Mode: 라이브 영향 없이 새 알고리즘 A/B 검증 가능
```

**서브시스템 C: 리소스 풀 관리 (Browser Pool Lifecycle)**
```
듀얼 풀 아키텍처:
- Legacy Pool: 일반 플랫폼용 (10~16 인스턴스)
- Camoufox Pool: 강화 탐지 대응용 (10+ 인스턴스)
- 각 풀 독립 관리 → 리소스 경합 방지

세션 라이프사이클:
- 타임아웃: 3분 (유휴 세션 자동 종료)
- 최대 연장: 10회 × 3분 = 30분 상한
- 멱등성 플래그(counterDecremented): 이중 세션 카운트 감소 방지

오토스케일링:
- 프리워밍: 사용률 20% → 50% → 70%로 단계적 풀 확장
- 확인 주기: 15초

좀비 프로세스 관리:
- PID 레지스트리로 OS 프로세스 추적 (pidusage)
- 100개 이상 좀비 감지 시 리스타트 트리거
- SIGTERM → 5초 대기 → SIGKILL 폴백

Graceful Shutdown (Drain Mode):
- SIGTERM 수신 → 드레인 모드 활성화 (신규 요청 503)
- 인플라이트 요청 완료 대기
- 브라우저 세션 + Redis 커넥션 정리
- 헬스체크 경로(/health)는 드레인 중에도 통과 → LB가 즉시 감지
```

### 결과
- 외부 플랫폼 차단 폭증 시 **에러율 95% → 5%** (자동 트래픽 감소 + 점진적 복구)
- 인프라 비용 **30% 절감** (불필요한 요청 자동 차단)
- 장애 복구 시 **점진적 트래픽 증가**로 재차단 방지
- 배포 시 **데이터 유실 0** (Graceful Shutdown + Drain Mode)

### Java/Spring 대응
```
서킷 브레이커:
- Resilience4j CircuitBreaker: 동일 상태 머신 (CLOSED → OPEN → HALF_OPEN)
- 차이점: Resilience4j는 단일 JVM. 우리는 Redis로 다중 인스턴스 상태 공유

Rate Limiting:
- Resilience4j RateLimiter: 토큰 버킷 기반
- Bucket4j: Redis 기반 분산 Rate Limiting

라우팅:
- Spring Cloud LoadBalancer: 가중치 기반 (유사 패턴)
- Istio Service Mesh: 헬스체크 + 가중치 라우팅

리소스 풀:
- HikariCP: 커넥션 풀 라이프사이클 (동일 패턴)
- Apache Commons Pool2: 범용 객체 풀

Graceful Shutdown:
- Spring SmartLifecycle: @PreDestroy + getPhase()
- Kubernetes PreStop Hook + Readiness Probe
```

### 꼬리질문 방어

**Q1: "Resilience4j와 직접 구현한 것의 차이?"**
> Resilience4j는 단일 JVM 내에서 동작하지만, 저희는 다중 인스턴스(ECS 컨테이너 2~3개) 환경이라
> Redis 기반으로 상태를 공유해야 했습니다.
> 토큰 버킷의 잔량과 상태 전환 판단을 Redis Lua 스크립트로 원자적으로 처리해서
> 인스턴스 간 일관성을 보장했습니다.
> 또한 **Fail-Open 정책**을 적용해서 Redis 장애 시에도 요청을 허용합니다.
> Resilience4j의 기본 동작은 Fail-Closed인데, 우리 서비스는 가용성이 더 중요했습니다.

**Q2: "프록시 건강도 스코어링 공식의 가중치 근거?"**
> blockRate에 60을 곱한 이유는 차단이 가장 치명적이기 때문입니다.
> 한 번 차단된 IP는 복구가 어려우므로 패널티를 크게 줬고,
> latency는 상대적으로 덜 치명적이라 최대 25점으로 캡을 뒀습니다.
> 이 가중치는 2주간 운영 데이터의 "실제 차단된 프록시"와 "정상 프록시"를
> 역으로 분석해서 조정했습니다.

**Q3: "이 설계가 PG사 연동이나 외부 API 호출에도 적용 가능한가?"**
> 네, 핵심 패턴이 동일합니다. PG사(토스페이먼츠, 카카오페이 등)가 불안정할 때:
> 1) 서킷 브레이커로 장애 전파 차단
> 2) 건강도 기반으로 Primary/Fallback PG 자동 전환
> 3) Token Bucket으로 TPS 제어 (PG사 Rate Limit 준수)
> 4) Graceful Shutdown으로 배포 시 인플라이트 결제 완료 보장
> 우리가 프록시에 대해 한 것을 PG사 엔드포인트로 바꾸면 됩니다.

**Q4: "좀비 프로세스 관리가 왜 중요한가? 일반 백엔드에서 비슷한 문제는?"**
> 장시간 운영 서비스에서 리소스 누수는 서서히 축적되다가 갑자기 OOM으로 터집니다.
> JVM에서도 동일한 문제가 있습니다:
> - Thread leak: 스레드 풀에서 반환 안 된 스레드 → 풀 고갈
> - Connection leak: DB 커넥션 미반환 → HikariCP 타임아웃
> - File descriptor leak: 소켓 미해제 → "Too many open files"
> 모니터링 → 탐지 → 자동 정리의 3단계 패턴은 어떤 리소스든 동일합니다.

**Q5: "Drain Mode를 Kubernetes에서는 어떻게 구현하나?"**
> K8s에서는 PreStop Hook에서 일정 시간 sleep → Readiness Probe false 반환
> → LB가 트래픽 중단 → 인플라이트 요청 완료 → Pod 종료.
> 우리가 미들웨어 레벨에서 구현한 것과 동일한 패턴을 K8s가 인프라 레벨에서 제공합니다.
> 차이점은 우리는 애플리케이션이 직접 503을 반환하면서 헬스체크는 통과시킨 것이고,
> K8s는 Readiness Probe로 분리합니다.

---

## Episode 6: 2계층 캐시 + Cache Stampede 방지

### 상황
리뷰 메타데이터, 유저 설정, 플랫폼 계정 정보 등 읽기 빈도가 매우 높은 데이터.
단일 Redis 캐시로 시작했지만, Redis 레이턴시(네트워크 왕복)가 핫 데이터에서 병목.
또한 배치잡 완료 후 캐시 만료가 동시에 발생하면서 DB 부하 폭증 (Cache Stampede).

### 선택지

| 옵션 | 장점 | 단점 |
|------|------|------|
| A. Redis만 (TTL 길게) | 단순 | 핫 데이터 레이턴시, Stampede 미해결 |
| B. Caffeine(로컬) + Redis | L1 로컬로 네트워크 왕복 제거 | 인스턴스 간 일관성 문제 |
| C. Cache-Aside + Redis 분산 락 | Stampede 방지 | 구현 복잡도 증가 |

### 결정
**B+C 혼합: L1 In-Memory(5분 TTL) + L2 Redis(24시간 TTL) + 분산 락(Stampede 방지)**

### 구현 상세
```
조회 흐름:
1. L1 (In-Memory) 확인 → 히트 시 즉시 반환
2. L1 미스 → L2 (Redis) 확인 → 히트 시 L1에 저장 후 반환
3. L2 미스 → 분산 락 획득 → DB 조회 → L2 + L1에 저장 → 반환
4. 분산 락 획득 실패 → 대기 후 L2 재확인 (Double-Check 패턴)

무효화 전략:
- 데이터 변경 시 EventEmitter2로 이벤트 발행 → 이벤트 리스너가 L1 + L2 동시 삭제
- TTL 기반 만료 (L1: 5분, L2: 24시간)
- 프리픽스 기반 벌크 삭제 지원 (e.g., cache:prompt:* 전체 삭제)

Redis 장애 시 폴백:
- L2 조회 실패 시 L1 데이터로 서빙 (stale but available)
- L1도 없으면 DB 직접 조회 (캐시 우회)
```

### 결과
- L1 캐시로 핫 데이터 응답 지연 수 ms 이내
- L2 Redis로 인스턴스 간 일관성 유지
- 분산 락으로 배치 후 Cache Stampede 방지
- Redis 장애 시에도 서비스 가용성 유지

### Java/Spring 대응
```
- Caffeine (L1) + Spring Cache (@Cacheable): 로컬 캐시
- Redisson (L2): Redis 캐시 + 분산 락
- @CacheEvict: 이벤트 기반 무효화
- @Cacheable(sync=true): Stampede 방지 (Spring 내장)
```

### 꼬리질문 방어

**Q1: "L1 TTL 5분 동안 다른 인스턴스와 데이터가 다를 수 있는데?"**
> 맞습니다. 최대 5분간 stale 데이터가 서빙될 수 있습니다.
> 이 캐시를 적용하는 데이터는 "리뷰 타입 메타데이터", "설정 값" 등
> 5분 지연이 비즈니스에 영향이 없는 것만 선별했습니다.
> 결제/구독 같은 정합성 중요 데이터는 캐시를 적용하지 않습니다.

**Q2: "Write-Through 대신 Cache-Aside를 선택한 이유?"**
> 우리 서비스는 읽기가 쓰기보다 10:1 이상 많은 read-heavy 패턴입니다.
> Write-Through는 모든 쓰기에서 캐시도 업데이트해야 해서 쓰기 레이턴시가 증가합니다.
> Cache-Aside는 쓰기 시 캐시만 삭제하고, 다음 읽기 시 DB에서 다시 로드하므로
> 쓰기 성능에 영향이 없습니다.

**Q3: "Redis 클러스터에서 분산 락이 안전한가?"**
> Redis 클러스터의 비동기 복제 특성상, 마스터에서 락을 획득하고 슬레이브에 복제되기 전에
> 마스터가 죽으면 다른 클라이언트도 락을 획득할 수 있습니다.
> 이를 완벽히 방지하려면 RedLock이 필요하지만, 현재는 Stampede 방지 목적이라
> 최악의 경우에도 DB 쿼리 2~3개가 동시에 실행되는 정도여서 허용 범위입니다.

---

## Episode 7: 분산 세션 관리 + 리소스 풀 설계 + 프로토콜 레벨 장애 대응

### 상황
외부 플랫폼이 WAF(Web Application Firewall)를 강화하면서, 기존 HTTP 클라이언트 방식의
데이터 수집이 95% 이상 차단됨. 단순한 헤더 변경으로는 해결 불가 — **TLS 핑거프린트 레벨**에서
클라이언트를 식별하고 있었음. 30+ 인스턴스의 세션 풀을 관리하면서 장애 전파를 차단하고,
배포 시 데이터 유실 없이 무중단으로 교체해야 하는 복합 문제.

### 선택지

| 옵션 | 장점 | 단점 |
|------|------|------|
| A. API 직접 호출 | 빠르고 안정적 | Akamai가 TLS 핑거프린트로 Node.js 탐지 |
| B. Chromium 스텔스 | puppeteer-extra-stealth 플러그인 | Akamai가 Chromium 특유의 핑거프린트 탐지 |
| C. Camoufox (Firefox 기반) | Firefox TLS 핑거프린트, 별도 스텔스 | 리소스 2배 소모, 별도 브라우저 풀 필요 |

### 결정
**C. Camoufox** — 별도 브라우저 풀 운영 + 핑거프린트 스푸핑 + 프록시 라우팅

### 구현 상세
```
이 에피소드는 기술적 깊이가 여러 레이어에 걸쳐 있음:

1) TLS 핑거프린트 우회
   - Node.js의 TLS 핑거프린트는 Akamai에 의해 탐지됨
   - 해결: page.evaluate() 내에서 fetch()를 호출 — 브라우저의 TLS 스택 사용
   - 즉, HTTP 요청을 Node.js가 아니라 브라우저가 직접 보내게 함

2) 브라우저 핑거프린트 스푸핑
   - WebDriver 속성 제거
   - Canvas 핑거프린트 노이즈 (RGB ±1 랜덤)
   - WebGL 스푸핑 (Intel GPU 에뮬레이션)
   - navigator 속성 위조 (hardwareConcurrency=8, platform='MacIntel')
   - Chrome 플러그인 목록 위조

3) 듀얼 브라우저 풀
   - Legacy Pool (Chromium): 일반 플랫폼용 (10~16 인스턴스)
   - Camoufox Pool (Firefox): Akamai 대응용 (10+ 인스턴스)
   - Naver Pool (전용): 네이버 스마트플레이스용 (1 인스턴스)
   - 각 풀은 독립적으로 관리, 리소스 경합 방지

4) 세션 오염 방지
   - Akamai에 의해 차단된 세션은 즉시 파괴 (재활용 불가)
   - "핑거프린트 오염 상태가 전파되지 않도록"
   - SessionLockRegistry: FIFO/PRIORITY 큐로 세션 직렬화

5) 좀비 프로세스 관리
   - PID 레지스트리로 OS 프로세스 추적
   - pidusage로 실제 프로세스 상태 모니터링
   - 100개 이상 좀비 프로세스 감지 시 리스타트 트리거
   - SIGTERM → 5초 대기 → SIGKILL 폴백

6) 프리워밍 전략 (Naver 전용)
   - 첫 요청 레이턴시 감소를 위해 브라우저 + 세션을 미리 생성
   - 트래픽 증가 시 동적 풀 확장 (20% → 50% → 70%)
```

### 결과
- Cpeats 차단율: 95% → 5% 이하
- 세션 오염으로 인한 연쇄 실패 제거
- Graceful Shutdown으로 배포 시 데이터 유실 0

### Java/Spring 대응
```
이 에피소드는 Java/Spring으로 1:1 대응보다는 시스템 설계 역량의 증거로 활용:
- 서킷 브레이커 → Resilience4j
- 리소스 풀 관리 → Apache Commons Pool2 / HikariCP 패턴
- 프로세스 관리 → ProcessBuilder + Runtime.getRuntime().exec()
- Graceful Shutdown → Spring의 @PreDestroy + SmartLifecycle
```

### 꼬리질문 방어

**Q1: "이 경험이 일반 백엔드 개발과 어떤 관련이 있나?"**
> 핵심은 세 가지 범용 패턴입니다:
> 1) **리소스 풀 관리**: 브라우저 30+ 인스턴스 = DB 커넥션 풀, 스레드 풀과 동일 패턴
> 2) **분산 큐 + 공정성**: 세션별 FIFO 큐 + Lease TTL = 분산 락 + 작업 큐와 동일
> 3) **장애 전파 차단**: 오염된 세션 즉시 파괴 = Circuit Breaker의 Blast Radius 제한과 동일
> 이 패턴들은 PG사 연동, 외부 API 호출, K8s Pod 관리에서도 그대로 적용됩니다.

**Q2: "세션 락 레지스트리의 Lease TTL 90초는 어떻게 산출했나?"**
> 요청 타임아웃 기본값이 120초이고, grace period 30초를 빼서 90초로 설정했습니다.
> Lease가 90초 동안 갱신되지 않으면 해당 요청은 죽은 것으로 판단하고 다음 요청에 양보합니다.
> 이는 Redisson의 watchdog(30초 기본 + 자동 연장)과 동일한 원리입니다.

**Q3: "Cold Start Guard가 필요한 이유?"**
> 인스턴스가 재시작되면 메모리의 세션 상태는 날아가지만 Redis의 큐는 남아있습니다.
> 새 인스턴스가 뜰 때 이전 인스턴스의 stale 큐를 정리하지 않으면
> 영원히 대기하는 요청이 생깁니다.
> K8s StatefulSet에서 Pod 재시작 시 PVC의 stale 데이터를 정리하는 것과 같은 문제입니다.

**Q4: "이 아키텍처를 K8s에서 구현한다면 어떻게 다르게 하겠나?"**
> 브라우저 풀 → K8s Pod + HPA (수평 오토스케일링)
> 프리워밍 → K8s Warm Pool (EKS) 또는 Karpenter 프로비저너
> Sticky Session → K8s Service의 sessionAffinity: ClientIP
> Drain Mode → PreStop Hook + terminationGracePeriodSeconds
> 좀비 탐지 → Liveness Probe + 커스텀 메트릭 기반 HPA
> 핵심 패턴은 동일하고, 인프라 레벨에서 더 자연스럽게 제공됩니다.

---

## 부록: 에피소드 ↔ JD 매핑

| 에피소드 | 프레이밍 | 커버하는 JD 키워드 | 타겟 회사 |
|---------|---------|-----------------|---------|
| 1. 결제 트랜잭션 | 다단계 트랜잭션 + 옵티미스틱 락 | 트랜잭션, 락, 결제, 멱등성, ACID | 토스, 카카오페이, 라인페이, 당근페이 |
| 2. 분산 락 | Redis SET NX + Lua 원자적 해제 | Redis, 분산 시스템, 동시성 | 전체 |
| 3. 대시보드 집계 최적화 | 사전 계산 + 복합 인덱스 + 파티셔닝 | DB 최적화, 인덱스, 배치, 대용량 | 우아한, 쿠팡, 네이버 |
| 4. MQ + 에러 복구 | 4단계 에러 분류 + DLQ + 임계값 알림 | 메시지 큐, 이벤트 드리븐, 재시도 | 카카오, 토스, 쿠팡, 우아한 |
| **5. 분산 트래픽 제어** | **서킷 브레이커 + 적응형 라우팅 + 리소스 풀** | **장애 격리, Rate Limiting, 헬스체크, 오토스케일링** | **토스, 쿠팡, 라인, 네이버** |
| 6. 2계층 캐시 | L1+L2 + Stampede 방지 | 캐시, Redis, 성능 최적화 | 네이버, 카카오, 전체 |
| **7. 분산 세션 관리** | **리소스 풀 + Lease 기반 큐 + Graceful Shutdown** | **리소스 관리, 분산 큐, 무중단 배포, 프로토콜 디버깅** | **전체 (시스템 설계 면접)** |
