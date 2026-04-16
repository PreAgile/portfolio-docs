# JPA/Spring 실무 문제 Lab — 마스터 플랜

> **목적**: 국내 빅테크 + 글로벌 기업이 공개한 **JPA/Spring/트랜잭션/동시성 실무 문제**를 조사하고,  
> 본인 실무(cmong-be/mq/scraper-js/ml) 경험과 엮어 **Repo 1(concurrency-cache-lab)**에서 재현·해결·실측하는 Lab.  
> **Repo**: [concurrency-cache-lab](https://github.com/PreAgile/concurrency-cache-lab)  
> **연결**: Dirty Checking Lab (DC-1~5) 위에 쌓는 확장 실험군

---

## 왜 이 Lab인가 — 포지셔닝

| 축 | Track 1 (동시성 & 락) | Dirty Checking Lab | **이 Lab** |
|----|----|----|-----|
| **주제** | 정합성 — 락이 왜 필요한가 | JPA 내부 — Dirty Checking 메커니즘 | **JPA/Spring 실전 지뢰** — 실무에서 터지는 N+1, Proxy, 트랜잭션, Batch, Kotlin 함정 |
| **증거** | Lost Update 88건 실측 | readOnly/Enhancement Before/After | **기업 사례 + 본인 실무 + 재현 실험** |
| **면접 스토리** | "분산 락 단계적 해결" | "JPA 성능 튜닝 실측" | **"실무 코드에서 N+1이 터져서, 카카오페이 사례를 참고해 해결한 경험"** |

---

## Part 1: 기업 사례 조사 + 본인 실무 매핑

### 1.1 국내 빅테크 공개 사례

#### 카카오페이 — `@Transactional` 남발로 set_option 14K 쿼리

- **원문**: [JPA Transactional 잘 알고 쓰고 계신가요?](https://tech.kakaopay.com/post/jpa-transactional-bri/)
- **문제**: 클래스 단위 `@Transactional` 남발 → MySQL `set_option` 쿼리 약 14,000건 발생
- **해결**: 읽기 메서드에 `readOnly=true` 명시, 쓰기 메서드만 선택적 `@Transactional`
- **실험 연결**: DC-1 (readOnly 효과 측정)

#### 카카오페이 — Spring Batch 성능 최적화

- **원문**: [Spring Batch 애플리케이션 성능 향상을 위한 주요 팁](https://tech.kakaopay.com/post/spring-batch-performance/)
- **문제**: JPA `saveAll()` 기본 동작이 건별 INSERT → 대량 처리 시 성능 치명적
- **해결**: JDBC batch insert, chunk size 튜닝, ItemWriter 최적화
- **실험 연결**: JPA-4 (Batch Insert 성능)

#### 우아한형제들 — MySQL Named Lock 분산 락

- **원문**: [MySQL을 이용한 분산락으로 여러 서버에 걸친 동시성 관리](https://techblog.woowahan.com/2631/)
- **문제**: 다중 인스턴스 환경에서 광고 시스템 동시성 문제
- **해결**: MySQL `GET_LOCK()` / `RELEASE_LOCK()` — 추가 인프라 없이 분산 락
- **왜 MySQL?**: Redis 인프라 추가 비용 대비 사용량이 적어 MySQL로 충분
- **실험 연결**: Track 1 #6 (DB 락), JPA-2에서 Named Lock 대안 언급

#### 우아한형제들 — Kotlin에서 Hibernate 사용하기

- **원문**: [코틀린에서 하이버네이트를 사용할 수 있을까?](https://techblog.woowahan.com/2675/)
- **문제**: Kotlin `final` 기본값 → Proxy 생성 불가 → LAZY 로딩 깨짐
- **해결**: `kotlin-allopen` 플러그인 + `kotlin-jpa` 플러그인
- **실험 연결**: JPA-5 (Kotlin + JPA 함정)

#### 쿠팡 — 대규모 트래픽 처리 백엔드 전략

- **원문**: [대용량 트래픽 처리를 위한 쿠팡의 백엔드 전략](https://medium.com/coupang-engineering/%EB%8C%80%EC%9A%A9%EB%9F%89-%ED%8A%B8%EB%9E%98%ED%94%BD-%EC%B2%98%EB%A6%AC%EB%A5%BC-%EC%9C%84%ED%95%9C-%EC%BF%A0%ED%8C%A1%EC%9D%98-%EB%B0%B1%EC%97%94%EB%93%9C-%EC%A0%84%EB%9E%B5-184f7fdb1367)
- **전략**: 마이크로서비스별 데이터 분리 + 실시간 캐시 레이어 + NoSQL
- **결과**: 10배 처리량 개선, 1/3 지연 감소
- **실험 연결**: Track 3 L1+L2 캐시, TX-1 벌크 UPDATE 패턴

#### 토스 — 서버 증설 없이 대규모 트래픽 처리

- **원문**: [서버 증설 없이 처리하는 대규모 트래픽](https://toss.tech/article/monitoring-traffic)
- **전략**: 모니터링 기반 병목 식별 → 쿼리 최적화 → 캐시 전략
- **실험 연결**: Track 0 기준선 측정, DC-1 readOnly, JPA-3 OSIV 비활성화

#### 인프랩 — Spring Boot & JPA에서 Java와 Kotlin 함께 사용하기

- **원문**: [Spring Boot & JPA에서 Java와 Kotlin을 함께 사용하기](https://tech.inflab.com/20240110-java-and-kotlin/)
- **문제**: Java → Kotlin 마이그레이션 시 JPA 호환성 이슈
- **실험 연결**: JPA-5 (Kotlin + JPA 함정)

---

### 1.2 글로벌 공개 사례

#### Vlad Mihalcea (Hibernate 공식 커미터) — 종합

| 주제 | 원문 | 실험 연결 |
|------|------|----------|
| Dirty Checking 해부 | [Anatomy of Hibernate Dirty Checking](https://vladmihalcea.com/the-anatomy-of-hibernate-dirty-checking/) | DC-2, DC-3 |
| 1차 캐시 | [JPA First-Level Cache](https://vladmihalcea.com/jpa-hibernate-first-level-cache/) | DC-4, DC-5 |
| Bytecode Enhancement | [Enable Bytecode Enhancement](https://vladmihalcea.com/how-to-enable-bytecode-enhancement-dirty-checking-in-hibernate/) | DC-3 |
| readOnly 최적화 | [Spring Read-Only Transaction Optimization](https://vladmihalcea.com/spring-read-only-transaction-hibernate-optimization/) | DC-1 |
| Batch Insert | [Batch Processing Best Practices](https://vladmihalcea.com/jpa-hibernate-batch-insert-best-practices/) | JPA-4 |
| OSIV | [Open Session in View Anti-Pattern](https://vladmihalcea.com/the-open-session-in-view-anti-pattern/) | JPA-3 |

#### Baeldung — JPA 실전 가이드

| 주제 | 원문 | 실험 연결 |
|------|------|----------|
| @DynamicUpdate | [Spring Data JPA @DynamicUpdate](https://www.baeldung.com/spring-data-jpa-dynamicupdate) | DC-2 |
| Batch Insert | [Spring Data JPA Batch Inserts](https://www.baeldung.com/spring-data-jpa-batch-inserts) | JPA-4 |
| save vs saveAll | [Performance Difference](https://www.baeldung.com/spring-data-save-saveall) | JPA-4 |

#### DZone — JPA Bulk Insert 100배 성능

- **원문**: [Spring Boot: Boost JPA Bulk Insert Performance by 100x](https://dzone.com/articles/spring-boot-boost-jpa-bulk-insert-performance-by-100x)
- **핵심**: `IDENTITY` → `SEQUENCE` 전략 변경 + `hibernate.jdbc.batch_size` 설정
- **결과**: 1000건 INSERT 100배 성능 향상
- **실험 연결**: JPA-4

---

### 1.3 본인 실무(cmong-*) ↔ 기업 사례 ↔ Repo 1 매핑

> **주의**: 회사 코드/이름 노출 금지. Episode 번호로만 참조.

> **연결 유형 범례**: 🔵 직접 근거 (원문에 해당 내용 있음) / 🟡 간접 영감 (유사 문제를 다른 맥락에서 다룸) / ⚪ 비교 사례 (같은 카테고리의 다른 해결법)

| 본인 실무 경험 (Episode) | 기업 공개 사례 | 연결 유형 | Repo 1 실험 | 스토리라인 |
|---|---|:-:|---|---|
| **Ep.1** 결제 다단계 트랜잭션 + @Version | 우아한형제들 MySQL Named Lock | ⚪ 비교 | **TX-2** @Version 낙관적 락 | "낙관적 락 vs 비관적 락 트레이드오프를 실측" |
| **Ep.1** 부분 롤백 (QueryRunner) | Spring REQUIRES_NEW 패턴 | 🟡 간접 | **DC-5** REQUIRES_NEW 안티패턴 | "REQUIRES_NEW는 1차 캐시를 분리한다 → 자기 Lost Update 재발" |
| **Ep.2** Redis 분산 락 + Lua 스크립트 | 우아한형제들 MySQL Named Lock | 🔵 직접 | **Track 1 #7** Redisson | "MySQL 락 vs Redis 락 트레이드오프를 실측으로 비교" |
| **Ep.3** 수십만 Shop 집계 최적화 | 카카오페이 Batch 성능 | 🟡 간접 | **JPA-4** Batch Insert | "대량 INSERT 전략별 성능 실측" |
| **Ep.3** 복합 인덱스 설계 | Vlad Mihalcea N+1 해부 | 🔵 직접 | **JPA-1** N+1 해결 | "EAGER 기본값의 함정을 findAll()로 재현" |
| **Ep.4** MQ 에러 분류 + DLQ | Vlad Mihalcea Batch Processing | 🟡 간접 | **TX-1** 벌크 UPDATE | "영속성 컨텍스트 비일관을 실험으로 증명" |
| **Ep.5** 적응형 서킷 브레이커 | Vlad Mihalcea OSIV Anti-Pattern | 🔵 직접 | **JPA-3** OSIV | "OSIV가 영속성 컨텍스트를 요청 끝까지 열어두는 문제 재현" |
| **Ep.6** L1+L2 캐시 + Stampede 방지 | 쿠팡 캐시 레이어 | 🟡 간접 | **Track 3 #9~12** | "2계층 캐시 히트율 실측" |
| **Ep.7** 듀얼 브라우저 풀 | 우아한형제들 Kotlin+Hibernate | 🔵 직접 | **JPA-5** Kotlin+JPA 함정 | "Kotlin 클래스의 final 기본값이 Proxy 생성을 제한할 수 있다" |

---

## Part 2: 새로운 실험 로드맵

### Phase E: JPA 내부 메커니즘 (5개 실험)

| # | 이슈 | 실험 | 난이도 | 선행 레퍼런스 | 실무 연결 |
|:-:|:-:|------|:-:|---|---|
| **JPA-1** | [#18](https://github.com/PreAgile/concurrency-cache-lab/issues/18) | N+1 문제 계단식 재현 + 해결 | 쉬움 | Vlad Mihalcea, Baeldung | Ep.3 집계 최적화 |
| **JPA-2** | [#19](https://github.com/PreAgile/concurrency-cache-lab/issues/19) | Proxy 원리 실측 검증 | 쉬움 | Vlad Mihalcea 1차 캐시 | Ep.1 @Version 정합성 |
| **JPA-3** | [#20](https://github.com/PreAgile/concurrency-cache-lab/issues/20) | OSIV 비활성화 + DTO 패턴 | 중간 | 토스 트래픽 관리 | Ep.5 커넥션 관리 |
| **JPA-4** | [#21](https://github.com/PreAgile/concurrency-cache-lab/issues/21) | Batch Insert 100배 성능 | 중간 | 카카오페이 Batch, DZone | Ep.3 대량 데이터 |
| **JPA-5** | [#22](https://github.com/PreAgile/concurrency-cache-lab/issues/22) | Kotlin + JPA 5대 함정 | 중간 | 우아한형제들 Kotlin+Hibernate, 인프랩 | Ep.7 기술 전환 |

### Phase F: 트랜잭션 실무 패턴 (2개 실험)

| # | 이슈 | 실험 | 난이도 | 선행 레퍼런스 | 실무 연결 |
|:-:|:-:|------|:-:|---|---|
| **TX-1** | [#23](https://github.com/PreAgile/concurrency-cache-lab/issues/23) | 벌크 UPDATE vs Dirty Checking 성능 | 중간 | Vlad Mihalcea, Baeldung | Ep.3 배치 집계 |
| **TX-2** | [#24](https://github.com/PreAgile/concurrency-cache-lab/issues/24) | @Version 낙관적 락 + 재시도 패턴 | 중간 | 우아한형제들 분산락 | Ep.1 결제 정합성 |

---

## Part 3: 전체 Repo 1 이슈 맵 (확장 후)

```
Phase A: 인프라 + 기준선 ............... #1~#3   (기존)
Phase B: Track 1 — 동시성 & 분산 락 .... #4~#8   (기존)
Phase C: Track 3 — 캐시 & Stampede ..... #9~#12  (기존)
Phase D: Dirty Checking Lab ............ #13~#17 (DC-1~5, 기존)
Phase E: JPA 내부 메커니즘 .............. #18~#22 (JPA-1~5, 신규)
Phase F: 트랜잭션 실무 패턴 ............. #23~#24 (TX-1~2, 신규)
```

### 의존성 그래프 (확장)

```
Phase A: #1 → #2 → #3
                      │
         ┌────────────┼────────────────────────────┐
         │            │                            │
Phase B: #4→#5→#6→#7→#8                           │
                  ↓                                │
Phase C: #9 ──→ #10 ←─────┘                       │
                  ↓                                │
                 #11 → #12                         │
                                                   │
Phase D: DC-1→DC-4→DC-5→DC-2→DC-3   (#13→#16→#17→#14→#15)
                                                   │
Phase E: JPA-1 ←──── (독립, #3 이후 언제든)         │
         JPA-2 ←──── (독립, #3 이후 언제든)         │
         JPA-3 ←──── (DC-1 이후 권장)              │
         JPA-4 ←──── (독립)                        │
         JPA-5 ←──── (JPA-2 이후 권장)             │
                                                   │
Phase F: TX-1 ←──── (DC-2 이후 권장)               │
         TX-2 ←──── (Track 1 #7 이후)  ←──────────┘
```

---

## Part 4: 실험별 상세 설계

### JPA-1. N+1 문제 계단식 재현 + 해결

> **핵심**: "findAll() 한 번에 101개 쿼리가 나가는 걸 실측하고, @EntityGraph / fetch join / batch size 세 가지 해결법 비교"

**가설**:
1. `@ManyToOne` 기본 EAGER + `findAll()` → N+1 발생
2. `@ManyToOne(fetch = LAZY)` + 루프 접근 → N+1 발생
3. `@EntityGraph` / `fetch join` / `hibernate.default_batch_fetch_size` 로 해결

**기업 사례**: 🔵 Vlad Mihalcea N+1 해부 (직접 근거) / 🟡 카카오페이 `@Transactional` 사례는 세션 설정 쿼리가 주제이지만, N+1과 함께 발생하는 복합 성능 문제의 간접 영감

**실무 연결**: Ep.3 — 수십만 Shop 리뷰 조회 시 관련 엔티티 N+1로 쿼리 폭발

**측정**:
- Hibernate Statistics `prepareStatementCount`
- p6spy SQL 카운트
- k6 TPS / P99

---

### JPA-2. Proxy 원리 실측 검증

> **핵심**: "프록시가 ID를 이미 아는 이유, getReference의 SELECT 생략, equals 함정을 테스트 코드로 증명"

**가설**:
1. `proxy.getId()` → 쿼리 0회
2. `proxy.getName()` → 쿼리 1회 (초기화)
3. `em.getReference()` + persist → User SELECT 0회
4. `User.equals(User$Proxy)` → 기본 구현으로 false

**기업 사례**: Vlad Mihalcea 1차 캐시 동일성 보장 + 우아한형제들 Kotlin Hibernate

**실무 연결**: Ep.1 — 결제 엔티티 동일성 보장이 트랜잭션 정합성의 기반

---

### JPA-3. OSIV 비활성화 + DTO 변환 패턴

> **핵심**: "OSIV가 영속성 컨텍스트를 요청 끝까지 열어두는 동작을 확인하고, 비활성화 후 LazyInitException 재현, DTO 변환 패턴으로 해결"

**⚠️ 측정 주의**: OSIV는 영속성 컨텍스트의 라이프사이클을 제어하지만, DB 커넥션의 borrow/release 타이밍은 트랜잭션 경계와 커넥션 풀 설정에 따라 달라짐. 단순히 "OSIV=true → 커넥션 요청 끝까지 점유"는 항상 참이 아닐 수 있음.

**가설**:
1. OSIV=true → 컨트롤러에서 LAZY 접근 가능 (영속성 컨텍스트가 열려 있음)
2. OSIV=false → 서비스 메서드 종료 후 LAZY 접근 시 `LazyInitializationException` 발생
3. 서비스 레이어 DTO 변환 → OSIV=false에서도 정상 동작
4. (부가 관찰) 커넥션 borrow 시점과 SQL 로그 타임스탬프를 대조해 실제 점유 패턴 확인

**기업 사례**: 🔵 Vlad Mihalcea OSIV Anti-Pattern (직접 근거) / 🟡 토스 트래픽 관리 (간접 영감: 모니터링 기반 병목 식별이라는 접근법)

**실무 연결**: Ep.5 — 외부 API 호출 대기 중 리소스가 잠기는 문제 (커넥션 점유와 유사한 패턴)

**측정** (실험 목표를 좁힘 — "LazyInitException 재현 + DTO 패턴 필요성 증명"이 1차 목표):
- OSIV on/off 상태에서 LazyInitException 발생 여부
- p6spy SQL 로그에서 쿼리 시점 확인
- (부가) HikariCP `hikaricp_connections_usage_seconds` 히스토그램 관찰

---

### JPA-4. Batch Insert 성능 — IDENTITY 제약과 MySQL 환경에서의 대안

> **핵심**: "MySQL 환경에서 JPA의 IDENTITY 키 전략이 batch insert를 비활성화하는 구조적 제약을 증명하고, JDBC batch / TABLE 전략 등 실현 가능한 대안을 비교"

**⚠️ 주의 — MySQL은 네이티브 SEQUENCE를 지원하지 않음**:
- DZone 원문의 "IDENTITY → SEQUENCE 변경으로 100배" 는 **PostgreSQL 기준**
- MySQL에서 `GenerationType.SEQUENCE` 는 **TABLE 전략으로 에뮬레이션** 됨 → 별도 시퀀스 테이블에 행 잠금 발생
- 따라서 MySQL에서의 실험축은 **IDENTITY vs TABLE(pooled optimizer) vs JDBC batchUpdate**

**가설**:
1. `GenerationType.IDENTITY` → Hibernate batch insert **비활성화** (INSERT마다 `LAST_INSERT_ID()` 필요)
2. `GenerationType.TABLE` + `pooled optimizer` + `batch_size=50` → batch 묶기 가능하지만, 시퀀스 테이블 행 잠금 오버헤드 존재
3. JDBC `batchUpdate` + `rewriteBatchedStatements=true` → 가장 빠름 (MySQL 드라이버 레벨 최적화)
4. `saveAll()` vs `save()` 루프 → 트랜잭션 경계 차이

**기업 사례**: 🔵 카카오페이 Batch 성능 (직접 근거: JDBC batch + chunk 튜닝) / 🟡 DZone 100배 성능 (간접: PostgreSQL SEQUENCE 기준이지만 batch 원리는 동일)

**실무 연결**: Ep.3 — 매일 새벽 수십만 건 사전 계산 테이블 INSERT

**측정**:
- 10,000건 INSERT 소요 시간 (3회 중앙값)
- DB CPU 사용률
- MySQL General Log에서 실제 batch rewrite 확인

---

### JPA-5. Kotlin + JPA 5대 함정

> **핵심**: "Kotlin에서 JPA를 쓸 때 터지는 5가지 실전 함정을 재현하고, 각각의 해결법을 정리"

**함정 목록** (프록시 기반 LAZY 전략 기준 — Bytecode Enhancement 사용 시 동작이 달라질 수 있음):
1. **final 기본값** → 프록시 서브클래스 생성 불가 → LAZY 로딩이 **프록시 방식에서 제한**될 수 있음 (해결: `kotlin-allopen` 플러그인)
2. **기본 생성자 없음** → `InstantiationException` (해결: `kotlin-jpa` 플러그인)
3. **data class toString** → LAZY 필드 접근 시 **의도치 않은 초기화 트리거 가능** (해결: Entity에 data class 사용 지양)
4. **data class equals/hashCode** → 모든 필드 비교 → **프록시 초기화 및 동등성 부작용 가능** (해결: id 기반 직접 구현)
5. **val 필드와 변경 감지** → field access vs property access 전략에 따라 **Dirty Checking 동작이 달라질 수 있음** (해결: var + protected set, 또는 field access 명시)

**기업 사례**: 우아한형제들 Kotlin+Hibernate + 인프랩 Java+Kotlin 혼용

**실무 연결**: Ep.7 — Node.js → Kotlin 전환 시 예상되는 함정 사전 학습

---

### TX-1. 벌크 UPDATE vs Dirty Checking 성능 비교

> **핵심**: "10만 건 상태 변경에서 Dirty Checking forEach vs @Modifying 벌크 UPDATE 성능 + 영속성 컨텍스트 비일관 증명"

**가설**:
1. `forEach { it.status = EXPIRED }` → UPDATE 10만 번 + 영속성 컨텍스트 메모리 폭발
2. `@Modifying @Query("UPDATE ...")` → UPDATE 1번 + 영속성 컨텍스트와 비일관
3. `clearAutomatically = true` 로 비일관 해결

**기업 사례**: 카카오페이 Batch 성능 최적화

**실무 연결**: Ep.3 — 매일 대량 데이터 상태 변경 배치

---

### TX-2. @Version 낙관적 락 + 재시도 패턴

> **핵심**: "동시 포인트 차감에서 Lost Update 재현 → @Version으로 감지 → @Retryable로 재시도"

**시나리오 (통일)**: User(id=1, point=1000). 10 스레드가 동시에 각 -100 차감. 기대 최종 결과: 0.

**가설**:
1. `@Version` 없이 → Lost Update 발생 (최종 포인트 ≠ 0, 비결정적)
2. `@Version` 적용 → `OptimisticLockException` 발생 (충돌 감지는 하지만, 예외로 실패한 스레드의 차감 누락)
3. `@Retryable(maxAttempts=3)` → 충돌 시 재시도하여 **실패율 감소** (단, 동시 경합이 극심하면 3회로도 부족할 수 있음 — 재시도 후 충돌률/성공률을 측정)
4. 증분 UPDATE `SET point = point - 100` → Dirty Checking 우회, 원자적 처리 (최종 0 보장)

**기업 사례**: ⚪ 우아한형제들 MySQL Named Lock (비교 사례: 같은 동시성 문제를 비관적 락으로 해결한 접근)

**실무 연결**: Ep.1 — 결제 옵티미스틱 락 재시도 2회 설정 (충돌 빈도 0.1% 미만 환경)

---

## Part 5: 구현 순서 (추천)

### 전제: Phase A~D 는 기존 계획대로 진행 중

```
기준: Repo가 Java 17 기반이므로 Java로 바로 실행 가능한 실험 우선.
      Track 1 #7(Redisson)과 직접 비교 가능한 TX-2를 앞당김.

Week 1: 핵심 + 기존 Track 연결
  JPA-1 (N+1 재현)       — 가장 직관적, 시작하기 좋음
  JPA-2 (Proxy 원리)     — 오늘 대화 내용 그대로 테스트화
  TX-2 (@Version)        — Track 1 #7 완료 후 바로 연결. 낙관적 vs 비관적 비교

Week 2: 성능 실측
  JPA-4 (Batch Insert)   — 대량 데이터 성능 실측 (MySQL 환경 주의)
  TX-1 (벌크 UPDATE)     — DC-2 DynamicUpdate 와 짝

Week 3: 운영 패턴 + 확장
  JPA-3 (OSIV)           — DC-1 readOnly 와 짝
  JPA-5 (Kotlin+JPA)     — Repo에 Kotlin 모듈 추가 시 진행. Java 단독이면 후순위로 밀림
```

### 실험 완료 시 업데이트할 문서

| 실험 완료 | 업데이트할 곳 |
|-----------|-------------|
| JPA-1~5 | 각 실험 md 결과 섹션 + README Before/After 표 |
| TX-1~2 | 각 실험 md + LEARNING-LOG.md |
| 전체 | STRATEGY.md "현재 상태" + ROADMAP.md |

---

## Part 6: 면접 스토리라인 — 통합 서사

### 서사 1: "JPA의 편의성 뒤에 숨은 지뢰들"

> "JPA가 자동으로 해주는 것들(Dirty Checking, Proxy LAZY, 1차 캐시)이 편리하지만,
> 실무에서는 N+1, OSIV 커넥션 점유, 전체 컬럼 UPDATE, Batch Insert 비활성화 같은 지뢰가 있습니다.
> 저는 이 지뢰들을 **카카오페이·우아한형제들의 공개 사례를 참고**해서 사전 학습했고,
> **k6 + Hibernate Statistics로 실측 비교**해서 각각의 Before/After를 숫자로 증명했습니다."

### 서사 2: "실무 경험 → 재현 → 기업 사례 → 해결"

> "결제 시스템에서 **동시 업데이트 충돌(Ep.1)**을 겪었습니다. 옵티미스틱 락을 도입했지만 '재시도 몇 회?'라는 질문에 수치적 근거가 없었습니다.
> 포트폴리오에서 **동일 시나리오를 JPA @Version으로 재현**하고,
> **우아한형제들의 MySQL Named Lock 사례와 비교**해서
> '낙관적 락은 충돌률 0.1% 미만 환경에서 유리, 비관적 락은 높은 충돌 환경에서 유리' 라는 **실측 기반 판단 기준**을 만들었습니다."

### 서사 3: "Kotlin 전환 시 JPA 함정 사전 학습"

> "Node.js(TypeORM) 기반 서비스를 운영하면서(Ep.전체), Kotlin + Spring 전환을 준비했습니다.
> 우아한형제들과 인프랩이 공개한 **'Kotlin에서 Hibernate 쓸 수 있을까?'** 사례를 참고해
> **final 기본값 → Proxy 깨짐, data class → equals 함정** 등 5가지 실전 함정을 **사전 재현**하고
> `allopen`, `kotlin-jpa` 플러그인으로 해결하는 과정을 포트폴리오에 남겼습니다."

---

## 참고 레퍼런스 (전역)

### 국내 빅테크
- [카카오페이 — JPA Transactional](https://tech.kakaopay.com/post/jpa-transactional-bri/)
- [카카오페이 — Spring Batch 성능](https://tech.kakaopay.com/post/spring-batch-performance/)
- [우아한형제들 — MySQL 분산락](https://techblog.woowahan.com/2631/)
- [우아한형제들 — JPA 적용 사례](https://techblog.woowahan.com/2598/)
- [우아한형제들 — Kotlin + Hibernate](https://techblog.woowahan.com/2675/)
- [쿠팡 — 대규모 트래픽 백엔드 전략](https://medium.com/coupang-engineering/%EB%8C%80%EC%9A%A9%EB%9F%89-%ED%8A%B8%EB%9E%98%ED%94%BD-%EC%B2%98%EB%A6%AC%EB%A5%BC-%EC%9C%84%ED%95%9C-%EC%BF%A0%ED%8C%A1%EC%9D%98-%EB%B0%B1%EC%97%94%EB%93%9C-%EC%A0%84%EB%9E%B5-184f7fdb1367)
- [토스 — 서버 증설 없이 트래픽 처리](https://toss.tech/article/monitoring-traffic)
- [인프랩 — Java와 Kotlin 함께 사용하기](https://tech.inflab.com/20240110-java-and-kotlin/)

### 글로벌 (Vlad Mihalcea — Hibernate 공식 커미터)
- [Anatomy of Dirty Checking](https://vladmihalcea.com/the-anatomy-of-hibernate-dirty-checking/)
- [JPA First-Level Cache](https://vladmihalcea.com/jpa-hibernate-first-level-cache/)
- [Bytecode Enhancement](https://vladmihalcea.com/how-to-enable-bytecode-enhancement-dirty-checking-in-hibernate/)
- [readOnly Optimization](https://vladmihalcea.com/spring-read-only-transaction-hibernate-optimization/)
- [OSIV Anti-Pattern](https://vladmihalcea.com/the-open-session-in-view-anti-pattern/)

### 실무 패턴
- [Baeldung — @DynamicUpdate](https://www.baeldung.com/spring-data-jpa-dynamicupdate)
- [Baeldung — Batch Inserts](https://www.baeldung.com/spring-data-jpa-batch-inserts)
- [DZone — Bulk Insert 100x](https://dzone.com/articles/spring-boot-boost-jpa-bulk-insert-performance-by-100x)
- [Thorben Janssen — JPA Logging](https://thorben-janssen.com/spring-data-jpa-logging/)

---

_작성일: 2026-04-16_
_마지막 업데이트: 2026-04-16_
