# Lost Update — 배달앱 댓글 중복 등록 사고의 근본 원인

> **Repo**: concurrency-cache-lab
> **Issue**: [#4](https://github.com/PreAgile/concurrency-cache-lab/issues/4)
> **실험 문서**: [track1-01-no-lock.md](https://github.com/PreAgile/concurrency-cache-lab/blob/main/docs/experiments/track1-01-no-lock.md)
> **작성일**: 2026-04-15
> **대상 면접**: 시니어 백엔드 (3~10년차) — JPA, 동시성, 분산 시스템 깊이 검증

---

## 도메인 맥락 — 왜 "댓글 처리"인가

배달앱(네이버, 쿠팡이츠, 배민, 요기요 등) 리뷰에 사장님이 답글을 달 수 있는 기능.

### 실제 운영 구조

```
[어드민 웹] → [API 서버 (Backend)] ──HTTP POST──→ [스크래퍼 서비스]
                     │                                  │
                     ↓                                  ↓
             [reply_requests DB]            [실제 브라우저로 플랫폼 로그인]
                     ↑                      [→ 댓글 등록 (수초~수십초 소요)]
                     │                                  │
                     └────────── HTTP 응답 ─────────────┘
                            (성공/실패 + 외부 댓글 ID)
```

**핵심 특징**:
- API 서버(backend)는 스크래퍼에 **Long-running HTTP 요청**을 보냄 (평균 7초, p99 25초)
- 스크래퍼가 브라우저 자동화로 실제 플랫폼에 로그인 + 댓글 등록
- 응답 시간이 길어서 **동시성 경합이 발생할 윈도우가 넓음**

### 동시성 경합이 실제로 발생하는 이유

1. **타임아웃 기반 자동 재시도 + 수동 재시도 중첩**: 스크래퍼 응답 지연으로 자동 재시도 스케줄러가 재처리를 트리거 + 동시에 어드민에서 "재시도" 버튼 수동 클릭
2. **멀티 인스턴스 API 서버**: 30+ API 인스턴스 환경에서 같은 reply 재처리 API 요청이 로드밸런서에 의해 서로 다른 인스턴스로 동시 도달
3. **스크래퍼 라우팅 전환 시점**: 스크래퍼 헬스체크 실패로 요청이 다른 스크래퍼로 재전송될 때, 원래 요청이 사실 처리 중일 수 있음

### 비즈니스 임팩트

| 증상 | 영향 |
|------|------|
| 외부 플랫폼에 같은 답글 N번 등록 | 사장님 컴플레인, 서비스 신뢰 손상 |
| retry_count 누락 | 무한 재시도 방지 로직 무력화 |
| request_status 추적 불가 | 장애 대응/리포팅 혼란 |

---

## 이 실험의 핵심 수치

| 지표 | 값 | 비고 |
|------|------|------|
| 호출 건수 | 100 | ExecutorService + CountDownLatch |
| processReply 성공 (예외 없음) | 100 | 모두 정상 반환 |
| DB 최종 retry_count | **12** (중앙값) | 3회 측정: 13, 12, 10 |
| Lost Update | **88건 (88%)** | 평균 |
| 외부 API 호출 건수 | **100건** | DB 정합성과 무관하게 전부 호출됨 |
| TPS | 265 req/s | 정합성 없는 TPS |
| 환경 | MySQL 8, HikariCP max=20 | REPEATABLE READ |

> **한 줄 요약**: "DB의 retry_count는 12만 증가했는데 외부 플랫폼에는 답글 100개가 중복 등록되었습니다."

---

## 면접 시뮬레이션 — 꼬리질문 흐름

> **면접 포맷**: 면접관이 파고드는 흐름을 그대로 재현.
> **대응 원칙**: L1→L2→L3→L4→L5 순으로 자연스럽게 깊어지되, 이미 L3급 답변을 먼저 던지고 L4/L5는 꼬리질문에 대응.

---

## Q0. 실험 도메인 선정 정당성

### [면접관] "이 실험을 '댓글 처리'로 하셨는데, 왜 이 도메인을 골랐나요?"

**L1 — 개념 답변 (주니어 방어선)**

> "B2B SaaS 서비스에서 **외부 플랫폼 API 호출이 포함된 상태 머신**을 가진 도메인이라, 멱등성이 깨지면 즉시 비즈니스 사고로 이어집니다. 락의 존재 이유를 가장 명확하게 보여줄 수 있는 도메인이라고 판단했습니다."

### [꼬리질문] "실험을 위한 도메인이라면 더 단순한 것도 있잖아요. 카운터나 재고 같은."

**L2 — 원리 답변 (3년차 방어선)**

> "맞습니다. 하지만 이 실험의 목적이 두 가지였습니다.
>
> **첫째**, read-modify-write 패턴의 Lost Update 재현 — 이건 카운터로도 가능합니다.
>
> **둘째**, '외부 시스템이 이미 호출된 후 DB가 깨지는' 상황 재현 — 이건 **외부 부작용을 동반한 비멱등 상태 전이** 패턴인데, 카운터로는 보여줄 수 없습니다. 댓글 등록은 외부 플랫폼 호출이 들어가서 'DB는 롤백 가능하지만 외부 호출은 롤백 불가능'이라는 본질을 자연스럽게 포함합니다.
>
> 그래서 Lost Update 재현과 **외부 부작용이 있는 처리에서의 멱등성 깨짐**을 동시에 보여주려면 이 도메인이 최적이었습니다."

### [꼬리질문] "본인 업무와 직접 연결된 도메인인가요?"

**L5 — 실무 경험 (시니어)**

> "네, 현재 운영 중인 시스템입니다. B2B SaaS에서 6개 배달 플랫폼의 리뷰를 수집하고, 사장님이 답글을 달면 해당 플랫폼에 자동 등록하는 기능입니다. 구조는 API 서버가 스크래퍼 서비스에 HTTP POST로 요청을 보내고, 스크래퍼가 실제 브라우저를 띄워서 플랫폼에 로그인한 후 댓글을 등록합니다.
>
> 이 구조의 난이도는 **스크래퍼 응답 시간**입니다. 평균 7초, p99는 25초까지 걸려서 그 사이에 자동 재시도 스케줄러, 수동 재시도 버튼, 타임아웃 재전송이 겹치면 같은 reply에 동시 요청이 3~4개 겹치는 일이 흔합니다. 이 락이 없었던 시절 외부 플랫폼에 답글이 중복 등록되는 사고가 있었고, 그게 이 실험의 출발점입니다."

---

## Q1. Lost Update의 기본 원리

### [면접관] "Lost Update가 정확히 무엇이고, 실험에서 왜 발생했나요?"

**L1 — 개념 답변**

> "Lost Update는 두 개 이상의 트랜잭션이 같은 데이터를 read-modify-write 패턴으로 수정할 때, 한 트랜잭션의 수정이 다른 트랜잭션에 덮어써져 사라지는 현상입니다. 실험에서 100번의 processReply 호출 중 88번이 물리적으로 사라졌습니다."

**L2 — 원리 답변**

JPA의 Dirty Checking 흐름:

```java
@Transactional
public void processReply(Long id) {
    ReplyRequest req = repo.findById(id);   // [1] SELECT + 스냅샷 저장
    req.markProcessing();                    // [2] 메모리의 retry_count += 1
}                                            // [3] flush: 스냅샷과 비교해 UPDATE
```

두 API 서버 스레드가 동시에 실행되면:

```
시간 →
T1: BEGIN
T1: SELECT retry_count (=0)  ← 스냅샷: 0
                                T2: BEGIN
                                T2: SELECT retry_count (=0)  ← 스냅샷: 0
T1: markProcessing() (메모리 1)
                                T2: markProcessing() (메모리 1)
T1: UPDATE SET retry_count=1
T1: COMMIT  (DB=1)
                                T2: UPDATE SET retry_count=1
                                T2: COMMIT  (DB=1, T1 변경 덮어씀)

최종 DB=1, 기대값=2, Lost Update 1건
```

> **핵심**: Dirty Checking은 "내가 읽은 시점 기준 객체가 변경되었는가?"만 봅니다. **DB 현재 상태를 재확인하지 않습니다.**

### [꼬리질문] "그럼 한 트랜잭션이 DB를 실제로 언제 읽고 언제 쓰나요? flush 시점에도 다시 읽나요?"

**L3 — 타이밍 답변**

> "한 트랜잭션 생명주기에서 DB 접근은 **`findById`에서 SELECT 1번 + flush에서 UPDATE 1번**이 전부입니다. flush 시점에는 **DB를 다시 읽지 않습니다**."

```
@Transactional 메서드 진입
│
├─[T=0]── Persistence Context 생성 (비어 있음)
│
├─[T=1]── repo.findById(1L) 호출
│         │
│         ├─ 1차 캐시 확인 → 없음
│         ├─ SELECT * FROM reply_requests WHERE id=1   ← ★ DB 조회 (처음이자 마지막)
│         ├─ 결과를 엔티티로 변환(hydrate) + managed 상태로 저장
│         └─ loadedState 스냅샷 복제: Object[]{0, "PENDING", ...}
│
├─[T=2]── entity.markProcessing() 실행
│         │
│         ├─ this.retryCount = 1  (자바 객체 필드만 변경)
│         └─ DB에는 아무 일도 안 일어남
│
└─[T=3]── 메서드 종료 → @Transactional 커밋 직전
          │
          ├─ flush() 자동 호출
          │   ├─ loadedState vs current 필드별 비교 → Dirty!
          │   └─ UPDATE ... SET retry_count=1 WHERE id=1   ← ★ DB 쓰기만, 읽기 X
          │
          └─ COMMIT
```

**여러 스레드가 동시에 들어올 때**: 각 스레드는 **완전히 독립된 트랜잭션 + Persistence Context + 스냅샷**을 가집니다. 공유되는 건 DB뿐.

```
시간축 (ms)
 ├─0.010  T1: SELECT → retry_count=0, 스냅샷#1 = 0
 ├─0.011  T2: SELECT → retry_count=0, 스냅샷#2 = 0   ← T1이 아직 커밋 안 했으니 0
 ├─0.012  T3: SELECT → retry_count=0, 스냅샷#3 = 0   ← 같은 0
 │        ... (수십 개 스레드가 모두 0 읽음)
 │
 ├─0.030  T1: flush → UPDATE SET retry_count=1
 ├─0.031  T1: COMMIT                              (DB = 1)
 │
 ├─0.032  T2: flush → UPDATE SET retry_count=1    ← T1 대기 후 획득, 자기 스냅샷(0) 기준
 ├─0.033  T2: COMMIT                              (DB = 1, 덮어씀 → Lost!)
 │
 ├─0.034  T3: flush → UPDATE SET retry_count=1
 └─0.035  T3: COMMIT                              (또 덮어씀)
```

**시나리오별 DB 접근 횟수 정리**:

| 패턴 | SELECT | UPDATE | 결과 |
|------|:---:|:---:|------|
| 단일 스레드 1회 | 1 | 1 | 정상 |
| 100 스레드 순차 | 100 | 100 | 정상 |
| 100 스레드 동시 (현재 실험) | 100 | 100 | **88 Lost** |
| 100 + `@Version` | 100 | ~13 성공 + ~87 예외 | 정합성 OK, 재시도 필요 |
| 100 + `FOR UPDATE` | 100 (순차화) | 100 | 정합성 OK, 느림 |
| 100 + 분산 락 | 1 (첫 스레드만) | 1 | 99개는 락에 막혀 조기 반환 |

> 면접에서의 한 줄: **"flush는 쓰기 전용이고, 스냅샷은 로드 시점 값으로 고정됩니다. 각 트랜잭션이 자기만의 스냅샷 기준으로 UPDATE를 내보내기 때문에 여러 트랜잭션이 같은 시점의 DB를 읽으면 결과적으로 같은 새 값으로 서로를 덮어씁니다."**

### [꼬리질문] "그럼 Dirty Checking은 정확히 어떻게 구현되어 있나요? Hibernate 내부에서."

**L4 — CS 심화 (시니어 방어선)**

> "Hibernate는 엔티티를 로드할 때 **Persistence Context**에 엔티티 객체와 함께 **로드 시점 상태 스냅샷(loaded state)**을 함께 보관합니다. 스냅샷은 보통 필드값을 담은 배열 형태로 관리됩니다.
>
> flush 시점에 Hibernate는 각 엔티티에 대해 **현재 필드값 vs 스냅샷**을 필드별로 비교해 dirty property를 계산하고, 변경된 필드가 있으면 UPDATE SQL을 생성합니다. 정확한 코드 경로는 `EntityPersister.findDirty()` → 각 프로퍼티의 `Type.isDirty()`로 이어지고, bytecode enhancement가 켜져 있으면 `@LazyToOne`/dirty tracking 같은 별도 경로로 최적화됩니다.
>
> 중요한 건 이 매커니즘이 **DB 현재 상태를 참조하지 않는다**는 점입니다. T1이 커밋해서 DB가 1이 되어도 T2의 Hibernate는 자기 스냅샷(0)만 보고 '0 → 1 변경'으로 판단, UPDATE를 전송합니다. DB 입장에서는 이미 1인데 '1로 써라'가 오는 거죠.
>
> `@DynamicUpdate`를 쓰면 변경된 필드만 UPDATE에 포함하고, `@Version`을 쓰면 WHERE 절에 version 조건이 추가돼서 '내가 읽은 버전에서 안 바뀌었다'를 DB에 검증합니다. 단, 이건 Hibernate가 SQL WHERE를 바꾸는 방식이지 dirty checking 자체를 바꾸는 건 아닙니다."

---

<details>
<summary><b>🔍 깊게 파기 #1 — 스냅샷은 언제, 어디서, 어떻게 찍히는가</b></summary>

### 1-A. 스냅샷이 찍히는 시점 (load)

`findById`, JPQL 조회, 연관 엔티티 fetch 등 **엔티티가 Persistence Context에 "managed" 상태로 올라가는 모든 경로**에서 스냅샷이 찍힙니다.

흐름:

```
EntityManager.find(id)
  ↓
Session.get(entityClass, id)
  ↓
DefaultLoadEventListener.onLoad(LoadEvent)
  ↓
EntityPersister.load(id, ...) → ResultSet → hydrate
  ↓
TwoPhaseLoad.postHydrate(...)
  ↓
TwoPhaseLoad.initializeEntity(...)
  ↓
PersistenceContext.addEntity(entityKey, entity)
PersistenceContext.addEntry(entity, EntityEntry(
    loadedState = Object[]{ field1_value, field2_value, ... },  ← 스냅샷
    status = MANAGED,
    ...
))
```

**핵심**: 스냅샷(`loadedState`)은 **DB에서 읽은 값을 `Type.deepCopy()`로 복제한 배열**입니다. 참조가 아닌 값 복제라서 엔티티 객체가 나중에 변경돼도 스냅샷은 원래 값을 보존합니다.

### 1-B. 스냅샷이 비교되는 시점 (flush)

**자동 flush가 트리거되는 상황** (5가지):

1. `@Transactional` 메서드 종료 직전 (commit 전)
2. 명시적 `entityManager.flush()` 호출
3. JPQL 쿼리 실행 직전 (FlushModeType이 AUTO일 때, pending UPDATE가 쿼리 결과에 영향을 줄 수 있으니까)
4. Native Query 실행 직전 (`flushMode = ALWAYS`일 때)
5. Session.close() 직전 (주의: close 시점 자동 flush는 설정에 따라 다름)

**flush 내부 흐름**:

```
session.flush() / 트랜잭션 commit
  ↓
AbstractFlushingEventListener.flushEverythingToExecutions(FlushEvent)
  ↓
flushEntities(event, persistenceContext)
  ↓
for each managed entity:
    DefaultFlushEntityEventListener.onFlushEntity(FlushEntityEvent)
      ↓
    isUpdateNecessary(event)
      ↓
    dirtyCheck(FlushEntityEvent)  ← 여기서 비교 시작
      ↓
    int[] dirtyProperties =
        interceptor.findDirty(entity, id, currentState, loadedState, ...)
        // interceptor가 null/UNKNOWN 반환하면 ↓
        persister.findDirty(currentState, loadedState, entity, session)
          ↓
        for each property:
            Type.isDirty(loadedState[i], currentState[i], checkable[i], session)
              // 타입별로 비교:
              //   BasicType: Objects.equals()
              //   EntityType: id 비교
              //   CollectionType: 별도 로직
```

비교 결과 `dirtyProperties`가 빈 배열이 아니면 UPDATE SQL 생성 + executions 큐에 적재 → flush 마지막에 일괄 전송.

### 1-C. 왜 "스냅샷 배열"이라는 비싸 보이는 구조를 쓸까?

**설계 의도**:
1. **자동 변경 추적**: 개발자가 `save()`를 명시적으로 호출하지 않아도 setter만 호출하면 변경이 DB에 반영됨 (DX 향상)
2. **변경된 필드만 UPDATE 가능** (`@DynamicUpdate`와 조합)
3. **Interceptor/Listener 훅 제공**: `Interceptor.onFlushDirty()`로 감사 로그, 이벤트 발행 등에 활용

**대가**:
- 로드한 모든 엔티티마다 `Object[]` 1개를 메모리에 보관 → 대량 조회 시 메모리 압박
- flush 시 O(필드 수 × 엔티티 수)의 비교 연산

→ 이 비용을 줄이려고 나온 게 **Bytecode Enhancement의 dirty tracking** (아래 토글)

</details>

<details>
<summary><b>🔍 깊게 파기 #2 — Hibernate 실제 코드 경로 (클래스/메서드 매핑)</b></summary>

> Hibernate ORM 6.x 기준. 5.x도 경로 대부분 동일하지만 패키지/이름 일부 다름.

| 단계 | 클래스 | 메서드 | 역할 |
|------|--------|--------|------|
| 1 | `DefaultLoadEventListener` | `onLoad(LoadEvent)` | 로드 이벤트 진입점 |
| 2 | `TwoPhaseLoad` | `initializeEntity()` | 엔티티 초기화 + PC 등록 |
| 3 | `StatefulPersistenceContext` | `addEntry(entity, status, loadedState, ...)` | **스냅샷 배열 저장** |
| 4 | `EntityEntry` | `loadedState` 필드 | 로드 시점 값 배열 보관 |
| 5 | `DefaultFlushEventListener` | `onFlush(FlushEvent)` | flush 이벤트 진입점 |
| 6 | `AbstractFlushingEventListener` | `flushEverythingToExecutions()` | flush 전체 오케스트레이션 |
| 7 | `DefaultFlushEntityEventListener` | `onFlushEntity(FlushEntityEvent)` | 엔티티별 flush 처리 |
| 8 | `DefaultFlushEntityEventListener` | `isUpdateNecessary()` | **dirty 계산 진입점** |
| 9 | `EntityPersister` (인터페이스) | `findDirty(current, loaded, entity, session)` | 필드별 비교 위임 |
| 10 | `AbstractEntityPersister` (구현) | `findDirty()` → `TypeHelper.findDirty()` | 실제 비교 |
| 11 | `Type` 구현체들 | `isDirty(old, current, checkable, session)` | 타입별 dirty 판정 |

**찾아보기 좋은 시작점** (한 메서드만 본다면):
- `DefaultFlushEntityEventListener#dirtyCheck(FlushEntityEvent event)` — dirty 계산의 핵심 로직
- `AbstractEntityPersister#findDirty(...)` — 실제 필드 비교 루프

**버전별 위치 차이**:
- 5.x: `org.hibernate.event.internal.*`
- 6.x: 패키지는 동일하지만 `Type` 계층 일부가 `org.hibernate.type.descriptor.java.*`, `JavaType` 기반으로 리팩터링됨

실제 IntelliJ에서 Hibernate 소스를 열려면:
```
1. build.gradle에서 hibernate-core 버전 확인
2. External Libraries > hibernate-core-*.jar
3. 위 클래스명으로 찾기 (Cmd+Shift+O)
```

</details>

<details>
<summary><b>🔍 깊게 파기 #3 — Bytecode Enhancement란 무엇인가</b></summary>

### 3-A. 정의

**Hibernate가 컴파일 타임(또는 로드 타임)에 엔티티 클래스의 바이트코드를 조작**해서 필드 접근/변경을 가로채는 기능. Java 소스는 그대로지만, `.class` 파일이 Hibernate가 주입한 코드로 변형됨.

### 3-B. 활성화 방법

**Gradle**:
```groovy
plugins {
    id 'org.hibernate.orm' version '6.x.x'
}

hibernate {
    enhancement {
        enableLazyInitialization = true     // @LazyToOne 실 동작
        enableDirtyTracking = true          // SelfDirtinessTracker 주입
        enableAssociationManagement = true  // 양방향 연관 자동 동기화
    }
}
```

**Maven**: `hibernate-enhance-maven-plugin`으로 동일 옵션 설정.

### 3-C. Bytecode Enhancement의 3대 기능

#### (1) Lazy Initialization (for basic fields / @LazyGroup)

일반적으로 Hibernate의 LAZY는 **연관 엔티티**에만 적용됩니다(`@ManyToOne(fetch = LAZY)` 등). **기본 필드(BLOB, TEXT 같은 큰 컬럼)는 항상 EAGER**입니다.

Bytecode Enhancement를 켜면 기본 필드에도 `@Basic(fetch = LAZY)`를 붙일 수 있게 되고, 해당 필드 getter 호출 시점에 별도 SELECT를 날리도록 바이트코드에 hook이 주입됩니다.

#### (2) Dirty Tracking — 이게 이번 주제의 핵심

**기본 (Enhancement 없음)**:
- 엔티티 로드 시 `Object[] loadedState` 스냅샷 복제
- flush 시 현재 필드값 vs 스냅샷 전체 비교 → O(N) 비교

**Enhancement 있음**:
- 엔티티 클래스가 `SelfDirtinessTracker` 인터페이스를 구현하도록 바이트코드 변환
- 모든 setter에 "이 필드가 바뀌었음"을 기록하는 코드 주입
- flush 시 "바뀐 필드 이름 목록"만 바로 읽음 → **스냅샷 비교 생략**

변환 전후 개념적 이미지:

```java
// 원본 코드
@Entity
public class ReplyRequest {
    private int retryCount;
    public void setRetryCount(int v) { this.retryCount = v; }
}

// Enhancement 후 (개념적 의사 바이트코드)
@Entity
public class ReplyRequest implements SelfDirtinessTracker {
    private int retryCount;
    private transient Set<String> $$_hibernate_tracker;

    public void setRetryCount(int v) {
        if ($$_hibernate_tracker != null && this.retryCount != v) {
            $$_hibernate_tracker.add("retryCount");  // ← 주입된 코드
        }
        this.retryCount = v;
    }

    @Override
    public String[] $$_hibernate_getDirtyAttributes() {
        return $$_hibernate_tracker.toArray(new String[0]);
    }
}
```

**장점**:
- **state-diff 비용 감소**: flush 시 "엔티티에게 무엇이 바뀌었는지 직접 묻는" 방식으로 전환되어 전체 필드 비교 루프 부담이 줄어듦
- 메모리 절약: 구현에 따라 스냅샷 보유 방식이 최적화될 수 있음 (단, "스냅샷을 항상 완전히 없앤다"는 공식 보증은 아니므로 단정은 금물)
- "정말로 바뀐 필드"만 추적돼서 `@DynamicUpdate`의 효과 극대화

**비용**:
- 빌드 단계에 추가 작업
- 디버깅 시 바이트코드 변형이 있어 혼란 가능
- 실수로 Enhancement 플러그인이 빠지면 동작이 조용히 바뀜

### 3-D. Dirty Checking의 두 경로 (요약)

| 경로 | Enhancement | 변경 감지 방식 | flush 비교 비용 |
|------|:---:|---|---|
| **기본** | ✗ | flush 시점에 **현재 상태 vs loadedState**를 필드별 diff | O(필드 수) 전체 비교 |
| **Enhanced** | ✓ | 엔티티가 **자기가 뭘 바꿨는지 직접 보고**하는 방식 (self-dirty tracking) | state-diff 비용 감소 |

> ⚠️ "Enhanced = 스냅샷이 완전히 없다"는 단정은 피하세요. Hibernate 공식 문서도 "state-diff 대신 엔티티에게 묻는다" 정도로 설명하고, 내부 최적화의 구체 범위는 버전/설정에 따라 다릅니다. **핵심 메시지는 'state-diff 비용을 줄인다'**입니다.

실험의 `concurrency-cache-lab`은 Enhancement를 켜지 않은 상태라 **기본 경로**로 동작합니다. 그래서 Q1 본문의 설명은 기본 경로 기준.

</details>

<details>
<summary><b>🔍 깊게 파기 #4 — @LazyToOne / Dirty Tracking 어노테이션 정리</b></summary>

### 4-A. `@LazyToOne` — OneToOne 진짜 LAZY 동작

```java
@Entity
public class ReplyRequest {
    @OneToOne(fetch = FetchType.LAZY)
    @LazyToOne(LazyToOneOption.NO_PROXY)
    private Review review;
}
```

**문제의 본질**: Hibernate에서 **singular association의 LAZY는 제약이 많습니다**. 특히 비주인 측(non-owning side)의 `@OneToOne`은 null/객체 판정을 위해 실제 로딩이 필요한 경우가 있어, 설정에 따라 EAGER처럼 동작할 수 있습니다.

**정리**:
- **@ManyToOne(fetch = LAZY)**: 외래 키 값이 엔티티 자신에게 있어서 프록시로 처리 가능 → 일반적으로 의도대로 LAZY 동작
- **@OneToOne(fetch = LAZY) (주인 측)**: 외래 키를 본인이 갖고 있으면 프록시 처리 가능
- **@OneToOne(fetch = LAZY) (비주인 측, `mappedBy`)**: null 여부 판별에 원격 조회가 필요해 **LAZY가 제약됨**

**해결**: Bytecode Enhancement + `@LazyToOne(LazyToOneOption.NO_PROXY)`
- 소유 측 엔티티의 필드 접근 시점에 Enhancement 코드가 가로채서 **그 시점에만 DB fetch**
- 프록시 없이 진짜 지연 로딩 가능

> 단, provider(Hibernate/EclipseLink), 버전, owner 여부, Enhancement 설정이 겹쳐 결과가 달라지므로 면접에서는 **"Hibernate 기준 singular association LAZY는 제약이 많아서 bytecode enhancement와 함께 보는 게 안전하다"** 정도로 톤을 낮추는 게 정확합니다.

### 4-B. `@DynamicUpdate` vs Dirty Tracking 관계

```java
@Entity
@DynamicUpdate
public class ReplyRequest { ... }
```

| 기능 | 역할 |
|------|------|
| **Dirty Tracking** | "어떤 필드가 바뀌었는가?"를 감지 (런타임 동작) |
| **@DynamicUpdate** | 감지된 dirty 필드만 UPDATE 문에 포함 (SQL 생성) |

둘은 **독립적**:
- `@DynamicUpdate` 없음 + Enhancement 없음: 모든 필드로 `UPDATE` 생성 → **SQL이 고정 형태 → JDBC prepared statement 캐시 재사용성 높음**
- `@DynamicUpdate` 있음 + Enhancement 없음: dirty 필드만 포함 → **SQL이 매번 달라져 statement 캐시 재사용성 낮음**
- Enhancement 있음: 위 둘의 감지 방식만 달라짐, 생성되는 SQL은 `@DynamicUpdate` 여부에 따라 결정

### 4-C. `@Version` — 낙관적 락

Dirty Tracking과는 **완전히 별개의 축**:

```sql
-- @Version 있을 때 Hibernate가 생성
UPDATE reply_requests
SET retry_count = ?, version = ?
WHERE id = ? AND version = ?  ← 이 조건으로 충돌 감지
```

- Dirty Tracking: "애플리케이션 메모리에서 바뀐 필드가 있는가?"
- `@Version`: "내가 읽은 버전과 DB 현재 버전이 같은가?"

Q2에서도 말했듯, **DB 현재 상태 검증은 Dirty Checking이 아니라 `@Version`의 WHERE 조건**으로 이뤄집니다.

</details>

<details>
<summary><b>🔍 깊게 파기 #5 — "DB 현재 상태를 참조하지 않는다" 아키텍처 그림</b></summary>

### 5-A. 두 트랜잭션 × 두 Persistence Context × 하나의 DB

```
                         ┌───────────────────────────────┐
                         │         MySQL (InnoDB)        │
                         │  ┌─────────────────────────┐  │
                         │  │ reply_requests.id=1     │  │
                         │  │ retry_count = 0         │  │
                         │  └─────────────────────────┘  │
                         └─────────┬─────────────┬───────┘
                                   │             │
                        SELECT ────┘             └──── SELECT
                        (MVCC)                       (MVCC)
                           │                            │
                           ▼                            ▼
     ┌────────────────────────────┐    ┌────────────────────────────┐
     │   Thread T1                │    │   Thread T2                │
     │   Transaction T1           │    │   Transaction T2           │
     │                            │    │                            │
     │  Persistence Context #1    │    │  Persistence Context #2    │
     │  ┌──────────────────────┐  │    │  ┌──────────────────────┐  │
     │  │ managed entity:       │  │    │  │ managed entity:       │  │
     │  │   retry_count = 0     │  │    │  │   retry_count = 0     │  │
     │  │                       │  │    │  │                       │  │
     │  │ EntityEntry:          │  │    │  │ EntityEntry:          │  │
     │  │   loadedState[        │  │    │  │   loadedState[        │  │
     │  │     retry_count: 0    │  │    │  │     retry_count: 0    │  │
     │  │   ]  ◄── 스냅샷        │  │    │  │   ]  ◄── 스냅샷        │  │
     │  └──────────────────────┘  │    │  └──────────────────────┘  │
     │                            │    │                            │
     │  markProcessing():         │    │  markProcessing():         │
     │    retry_count = 1         │    │    retry_count = 1         │
     │                            │    │                            │
     │  [flush]                   │    │  [flush]                   │
     │  dirty check:              │    │  dirty check:              │
     │    current(1) vs snap(0)   │    │    current(1) vs snap(0)   │
     │    → DIRTY                 │    │    → DIRTY                 │
     │  UPDATE retry_count = 1    │    │  UPDATE retry_count = 1    │
     └────────┬───────────────────┘    └───────────────────┬───────┘
              │                                            │
              │  각자 자기 스냅샷만 보고 UPDATE 생성          │
              │  DB의 현재 값은 확인하지 않음                 │
              ▼                                            ▼
                         ┌───────────────────────────────┐
                         │         MySQL (InnoDB)        │
                         │                               │
                         │  T1 UPDATE → X-lock 획득       │
                         │   retry_count = 1              │
                         │  T1 COMMIT                     │
                         │   ── DB 값: 1 ──               │
                         │                               │
                         │  T2 UPDATE → T1 대기 후 획득    │
                         │   retry_count = 1 (덮어씀)     │
                         │  T2 COMMIT                     │
                         │   ── DB 값: 1 (Lost!) ──      │
                         └───────────────────────────────┘
```

### 5-B. 핵심 세 가지 단절

```
[단절 1] T1과 T2의 Persistence Context는 서로 완전히 분리
  → T1이 변경한 엔티티를 T2가 공유하지 않음
  → 각자 자기 스냅샷 따로 가짐

[단절 2] 스냅샷은 "로드 시점"의 값, DB의 "현재" 값이 아님
  → T2의 스냅샷은 0으로 고정
  → T1이 DB를 1로 바꾼 후에도 T2의 스냅샷은 여전히 0

[단절 3] UPDATE는 "값으로 써라"이지 "값으로 증가시켜라"가 아님
  → T2의 UPDATE는 "retry_count = 1" (절대값)
  → DB가 이미 1이어도 다시 1로 덮어씀
  → 만약 UPDATE가 "retry_count = retry_count + 1"이었으면 Lost Update 없음
```

### 5-C. 이 그림이 왜 중요한가

이 세 단절을 이해하면 **모든 락 전략의 동작 원리가 명확해집니다**:

| 전략 | 어느 단절을 메우는가? |
|------|---------------------|
| **@Version (낙관적)** | [단절 2] — UPDATE의 WHERE에 `version = ?`을 추가해 스냅샷 유효성을 DB에 검증 |
| **SELECT FOR UPDATE (비관적)** | [단절 1] — 읽는 순간 X-lock으로 다른 트랜잭션이 읽지도 못하게 함 |
| **SERIALIZABLE** | [단절 1, 2] — 읽기까지 락 범위에 포함 |
| **분산 락 (Redis)** | [단절 1] — DB 밖에서 동시 진입 자체를 막음 |
| **UPDATE ... SET x = x + 1** | [단절 3] — 절대값이 아닌 상대 연산으로 바꿔 DB가 현재 값 기준으로 계산 |

이 매핑을 답할 수 있으면 "그 락은 왜 효과가 있나?"에 대한 **메커니즘 수준의 이해**를 보여줄 수 있습니다.

</details>

<details>
<summary><b>🔍 깊게 파기 #6 — 코드단에서 Dirty Checking 동작을 실제로 관측하는 7가지 방법</b></summary>

이론만 아는 게 아니라 **"직접 눈으로 확인했다"**를 보여주려면 이 방법들을 쓸 수 있어야 합니다.

### 6-A. SQL 레벨 로깅 (가장 기초)

`application.yml`:
```yaml
logging:
  level:
    org.hibernate.SQL: DEBUG                              # UPDATE/INSERT SQL 출력
    org.hibernate.orm.jdbc.bind: TRACE                    # 파라미터 바인딩 값 (6.x)
    org.hibernate.type.descriptor.sql.BasicBinder: TRACE  # 5.x 버전
spring:
  jpa:
    properties:
      hibernate:
        format_sql: true
        use_sql_comments: true   # SQL에 주석으로 호출 위치 표시
```

**확인할 수 있는 것**:
- Dirty 필드만 바뀌었는데 모든 컬럼이 UPDATE에 들어가는지 (`@DynamicUpdate` 없을 때)
- 스냅샷 비교 후 변경 없으면 UPDATE 자체가 발생하지 않는지
- `@Version` 걸었을 때 WHERE 절에 `version = ?`가 붙는지

**한계**: Hibernate가 생성한 최종 SQL만 보여줌. "왜 이 SQL이 생성됐는지"는 모름.

### 6-B. Hibernate Statistics (로드/업데이트 카운트)

```yaml
spring:
  jpa:
    properties:
      hibernate:
        generate_statistics: true
```

```java
@Autowired
private EntityManagerFactory emf;

void printStats() {
    Statistics stats = emf.unwrap(SessionFactory.class).getStatistics();
    System.out.println("Entity loads: " + stats.getEntityLoadCount());
    System.out.println("Entity updates: " + stats.getEntityUpdateCount());
    System.out.println("Flushes: " + stats.getFlushCount());
    EntityStatistics es = stats.getEntityStatistics("com.lemong.lab.domain.reply.ReplyRequest");
    System.out.println("ReplyRequest updates: " + es.getUpdateCount());
}
```

**활용**: 로직이 "엔티티 1개를 1번 업데이트했는지, 모르게 N번 업데이트 했는지" 검증.

### 6-C. Hibernate Interceptor로 dirty 필드 실시간 관찰

```java
// no-arg 생성자 필수 — Hibernate가 FQCN으로 인스턴스 생성
public class DirtyCheckLoggingInterceptor implements Interceptor {

    @Override
    public boolean onFlushDirty(Object entity, Object id,
                                Object[] currentState, Object[] previousState,
                                String[] propertyNames, Type[] types) {
        List<String> dirty = new ArrayList<>();
        for (int i = 0; i < propertyNames.length; i++) {
            if (!Objects.equals(currentState[i], previousState[i])) {
                dirty.add(propertyNames[i]
                    + ": " + previousState[i] + " → " + currentState[i]);
            }
        }
        System.out.println("[DIRTY] " + entity.getClass().getSimpleName()
            + " id=" + id + " changes=" + dirty);
        return false;  // Hibernate의 기본 dirty 계산을 그대로 사용
    }
}
```

**등록 방법 2가지**:

**(1) Hibernate 설정으로 FQCN 지정 (가장 간단, Spring DI 없음)**
```yaml
spring:
  jpa:
    properties:
      hibernate:
        session_factory.interceptor: com.lemong.lab.DirtyCheckLoggingInterceptor
```
Hibernate가 no-arg 생성자로 직접 인스턴스화합니다. **Spring bean 주입은 되지 않으므로** `@Autowired` 필드가 있으면 null입니다.

**(2) HibernatePropertiesCustomizer로 Spring bean을 주입하고 싶을 때**
```java
@Configuration
class HibernateConfig {
    @Bean
    HibernatePropertiesCustomizer interceptorCustomizer(
            DirtyCheckLoggingInterceptor interceptor) {
        return props -> props.put("hibernate.session_factory.interceptor", interceptor);
    }
}
```
이렇게 하면 Spring이 만든 bean 인스턴스를 Hibernate에 넘길 수 있어 DI가 작동합니다 (생성자 주입 등).

> 흔한 오해: `@Component`만 붙이면 Hibernate가 알아서 쓰는 줄 알지만, Hibernate는 Spring ApplicationContext를 모릅니다. 두 방식 중 하나를 명시적으로 연결해야 합니다.

**확인할 수 있는 것**:
- `currentState` = 현재 엔티티 필드값
- `previousState` = 로드 시점 스냅샷
- **둘의 실제 내용을 직접 출력**해서 Dirty Checking 매커니즘을 눈으로 검증

### 6-D. JPA EntityListener / Callback

Interceptor보다 가볍고 엔티티 단위로 적용 가능:

```java
@Entity
@EntityListeners(ReplyRequestAuditListener.class)
public class ReplyRequest { ... }

public class ReplyRequestAuditListener {
    @PreUpdate
    public void beforeUpdate(ReplyRequest r) {
        log.info("[@PreUpdate] id={} retryCount={} status={}",
            r.getId(), r.getRetryCount(), r.getRequestStatus());
    }
}
```

**한계**: `previousState`가 안 보이고 현재 상태만 보임. 스냅샷 비교는 못 함.

### 6-E. 디버거 breakpoint로 Persistence Context 내부 들여다보기

IntelliJ나 VSCode에서:

1. `DefaultFlushEntityEventListener#dirtyCheck(FlushEntityEvent)` 에 breakpoint
2. Expression Evaluator로:
   ```
   event.getPropertyValues()                   // currentState
   event.getEntityEntry().getLoadedState()     // 스냅샷
   event.getSession().getPersistenceContext()
        .getEntry(event.getEntity()).getLoadedState()
   ```
3. 두 배열을 나란히 놓고 필드별 비교

**직접 확인 가능한 것**:
- 스냅샷 배열이 실제로 `Object[]`로 들어있는지
- `@Version` 필드가 스냅샷에 포함되어 있는지
- flush 시점에 어떤 엔티티들이 managed 상태로 남아있는지

### 6-F. Bytecode Enhancement 적용 여부 확인 (javap)

```bash
# 1. 엔티티 컴파일 후
javap -c -p build/classes/java/main/com/lemong/lab/domain/reply/ReplyRequest.class
```

Enhancement가 적용됐다면 다음과 같은 **주입된 메서드**가 보입니다:

```
public void $$_hibernate_trackChange(java.lang.String);
public boolean $$_hibernate_hasDirtyAttributes();
public java.lang.String[] $$_hibernate_getDirtyAttributes();
public void $$_hibernate_clearDirtyAttributes();
```

인터페이스 구현 확인:
```bash
javap -p ReplyRequest.class | grep implements
# implements org.hibernate.engine.spi.PersistentAttributeInterceptable, ...
```

**없으면 Enhancement 미적용 → 기본 스냅샷 비교 경로 사용 중**.

### 6-G. p6spy / datasource-proxy로 실제 실행된 SQL 캡처

Hibernate가 생성한 SQL과 실제 DB에 보낸 SQL이 다를 수 있음 (prepared statement 재사용 등). 100% 확실한 검증은 JDBC 레이어에서:

```yaml
# build.gradle
implementation 'com.github.gavlyukovskiy:p6spy-spring-boot-starter:1.9.0'

# application.yml
decorator:
  datasource:
    p6spy:
      enable-logging: true
      multiline: true
```

**실제 DB에 도달한 SQL + 실행 시간 + 파라미터 실값**까지 모두 로그에 남음. Hibernate 내부 로그와 비교하면 추상화 계층 간 간극 확인 가능.

### 6-H. Testcontainers로 Lost Update 직접 재현 (이 실험의 방식)

```java
@SpringBootTest
@Testcontainers
class LostUpdateReproductionTest {
    @Container
    static MySQLContainer<?> mysql = new MySQLContainer<>("mysql:8.0");

    @Test
    void 동시_100_스레드가_retry_count를_증가시킨다() {
        // ExecutorService + CountDownLatch로 100개 동시 호출
        // 최종 retry_count < 100 검증
    }
}
```

**장점**: CI에서도 재현 가능, 팀 전체가 '사고 재현 자산'으로 공유.

### 실전 팁 — 어떤 걸 어디서 쓰나

| 상황 | 추천 도구 |
|------|-----------|
| "이 엔티티가 왜 UPDATE 되지?" | **Interceptor + 디버거** |
| "전체 시스템의 UPDATE 빈도가 이상하다" | **Hibernate Statistics + Grafana** |
| "운영에서 가끔 이상한 UPDATE가 나간다" | **p6spy 로그 + Interceptor 감사 기록** |
| "코드 변경 후 Dirty 검출이 바뀌었는지 확인" | **Testcontainers 재현 테스트** |
| "Enhancement가 정말 켜졌나?" | **javap + `$$_hibernate_` 메서드 확인** |

</details>

<details>
<summary><b>🔍 깊게 파기 #7 — 국내/해외 빅테크는 이 문제를 어떻게 풀었나 (공개 사례)</b></summary>

### 🇰🇷 국내 빅테크

#### 1. 우아한형제들 — "WMS 재고 이관을 위한 분산 락 사용기" (2025)

**문제**:
- 배민 WMS(창고 관리 시스템)에서 재고 "할당"과 "취소"가 동시에 들어오면 재고 수량이 깨짐
- 여러 인스턴스의 API 서버가 같은 재고 row를 동시 수정

**해결**:
- **이관요청서 단위의 분산 락 키** 설계
- 할당/취소 모두 동일한 락 키 사용 → 직렬화
- 락은 Redis 기반 (자세한 구현은 블로그 참조)

**교훈**: "락 키 설계는 기능 단위가 아니라 **경합이 발생하는 엔티티 단위**로 해야 한다." 할당과 취소가 서로 다른 키를 쓰면 락이 의미 없음.

출처: https://techblog.woowahan.com/17416/

#### 2. 우아한형제들 — "MySQL을 이용한 분산락으로 여러 서버에 걸친 동시성 관리"

**문제**:
- 광고 시스템에서 여러 서버가 같은 광고 캠페인을 동시 처리
- Redis/ZooKeeper 같은 추가 인프라 도입 없이 해결하고 싶음

**해결**:
- **MySQL `GET_LOCK()`, `RELEASE_LOCK()`** 네이티브 함수 사용
- 기존 RDBMS만으로 분산 락 구현
- 세션 단위 락이라 커넥션이 끊기면 자동 해제

**교훈**: "이미 가진 인프라로 풀 수 있다면 그 선택이 운영 비용 최저." 다만 MySQL 락은 Redis 대비 성능 낮음(수천 TPS) → 트래픽 규모에 맞춰 판단.

출처: https://techblog.woowahan.com/2631/

#### 3. 컬리(Kurly) — "풀필먼트 입고 서비스팀에서 분산락을 사용하는 방법 - Spring Redisson"

**문제**:
- 입고 처리 시 여러 작업자가 동일 상품에 대한 처리를 동시 수행
- 재고 정합성이 깨지면 잘못된 발주/입고 발생

**해결**:
- **Redisson `RLock` + Spring AOP**로 메서드 레벨 분산 락 구현
- `@DistributedLock(key = "#productId")` 같은 어노테이션 설계
- Watchdog으로 long-running 작업 중 TTL 자동 연장

**교훈**: 분산 락을 **AOP로 추상화**해서 비즈니스 코드에서는 어노테이션만 붙이면 되게 설계. 팀 전체의 러닝커브 낮춤.

출처: https://helloworld.kurly.com/blog/distributed-redisson-lock/

#### 4. 토스증권 — SLASH 22 "애플 한 주가 고객에게 전달되기까지"

**문제**:
- 주식 주문 시 사용자 자산 차감/보유 수량 변경이 동시 다발적으로 발생
- **단 1원도 틀리면 안 되는** 금융 시스템

**해결** (발표 자료 기준):
- **분산 락**으로 동시성 제어 (1차 방어)
- **JPA `@Version` 기반 낙관적 락**으로 갱신 분실 감지 (2차 방어)
- 이 둘을 **CAS(Compare-And-Swap) 스타일 패턴**으로 결합
- 락으로 충돌 자체를 줄이고, 혹시 샌 경우 낙관적 락이 예외로 잡음

**교훈**: "금융은 방어선이 하나면 안 된다." 단일 락에만 의존하면 Redis 장애 시 즉시 사고. **이중/삼중 방어** 필수.

출처:
- SLASH 22 페이지: https://toss.im/slash-22
- 발표 슬라이드 PDF: https://static.toss.im/assets/homepage/slash22/pt-session/SLASH22_%EC%9D%B4%EC%8A%B9%EC%B2%9C%EB%8B%98.pdf

#### 5. 카카오페이 기술 블로그 (일반 패턴 참조)

카카오페이 기술 블로그에는 결제/정산 관련 글이 여러 편 공개되어 있지만, **이 문서 작성 시점에 Lost Update/분산 락/멱등성을 직접 다루는 특정 글의 URL은 확인하지 못했습니다.** 업계에서 일반적으로 통용되는 결제 시스템 패턴(멱등성 키, 분산 락, DB 유니크 제약 3중 방어)과 맥락이 같다고 보되, 면접에서 구체적 인용이 필요하면 별도 확인 후 사용해야 합니다.

블로그 진입점: https://tech.kakaopay.com/ (주제별 글을 직접 확인 필요)

---

### 🌍 해외 빅테크

#### 1. Stripe — "Designing robust and predictable APIs with idempotency" (2017)

**문제**:
- 결제 API 호출이 네트워크 오류로 타임아웃 → 클라이언트는 재시도해야 하는데, 이미 결제된 건지 알 수 없음
- 재시도 시 **중복 결제 위험**

**해결**:
- 클라이언트가 생성한 **Idempotency Key (UUID)** 를 `Idempotency-Key` 헤더로 전송
- 서버는 **(key, 요청 본문 해시, 응답) 튜플을 24시간 저장**
- 같은 key로 재시도 시 캐시된 응답을 그대로 반환
- 처음 요청이 "진행 중"이면 409 Conflict로 응답해 클라이언트가 대기하게 함

**교훈**: **"멱등성은 서버 책임이지만, 키 생성은 클라이언트 책임."** 클라이언트가 재시도마다 같은 키를 보내야 의미가 있고, 이를 위해 SDK가 자동으로 UUID를 생성해줘야 함.

출처:
- 엔지니어링 블로그 (2017): https://stripe.com/blog/idempotency
- 공식 API 문서 (현행): https://docs.stripe.com/api/idempotent_requests

#### 2. Airbnb — "Avoiding Double Payments in a Distributed Payments System"

**문제**:
- 게스트가 예약 결제 → 호스트에게 정산 → 외부 은행 API 호출
- 중간에 **어느 한 단계라도 재시도되면 이중 결제/이중 정산** 발생 가능

**해결**:
- 자체 라이브러리 **"Orpheus"** 개발
- 모든 요청을 **pre-RPC, RPC, post-RPC 3단계**로 분리
- 각 단계마다 **idempotency key + DB row-level lock** 획득
- RPC 응답이 DB에 기록될 때까지 락 유지 → 중간 실패해도 다음 재시도가 정확히 재개

**교훈**: "네트워크 호출을 3단계로 쪼개면 각 단계를 독립적으로 멱등하게 만들 수 있다." 단일 메서드 내에 RPC를 숨기면 재시도가 정확히 어디서 중단됐는지 모름.

출처: https://medium.com/airbnb-engineering/avoiding-double-payments-in-a-distributed-payments-system-2981f6b070bb

#### 3. Shopify — "Surviving Flashes of High-Write Traffic"

**문제**:
- Black Friday 같은 플래시 세일에 **초당 수만 건의 쓰기 트래픽** 발생
- 같은 상품에 재고 차감이 동시에 들어오면 오버셀 위험

**해결** (블로그에서 직접 확인된 내용):
- **Pod 아키텍처**: 샵 단위로 DB를 샤딩해 독립된 pod으로 격리
- **Scriptable Load Balancer + Leaky Bucket**: 엣지에서 초당 요청 수를 제한해 DB까지 도달하는 트래픽 자체를 조절

> 참고: "재고 차감이 `SELECT FOR UPDATE` 기반이다"는 구체 구현은 해당 블로그 글에서 명시적으로 확인되지 않습니다. DB 레벨 락 전략은 일반적 추정이므로 면접에서는 언급하지 않는 게 안전합니다.

**교훈**: "락만으로는 절대 못 막는다." 락은 DB까지 도달한 요청을 직렬화할 뿐, **트래픽 자체를 엣지에서 걸러야** 시스템이 산다.

출처: https://shopify.engineering/blogs/engineering/surviving-flashes-of-high-write-traffic-using-scriptable-load-balancers-part-i

#### 4. Uber — "Real-Time Exactly-Once Event Processing with Flink, Kafka, Pinot"

**문제**:
- 광고 이벤트 처리에서 **절대 누락/중복 없이** 최소 지연으로 결과 발행 필요
- 분산 스트림 처리에서 exactly-once 보장

**해결**:
- **Kafka + Flink의 exactly-once semantics** 활용
- **Pinot의 upsert 연산**으로 중복 레코드 자동 병합
- 각 레코드에 **unique record identifier** 부여 → 중복 제거와 멱등성 동시 보장

**교훈**: "exactly-once delivery는 불가능하지만 exactly-once processing은 가능하다." 핵심은 **멱등한 쓰기 연산(upsert)** + **고유 식별자**.

출처 (1차):
- Uber Engineering 공식 블로그: https://www.uber.com/en-CH/blog/real-time-exactly-once-ad-event-processing/
- 참고 요약 (2차): https://www.infoq.com/news/2021/11/exactly-once-uber-flink-kafka/

#### 5. Martin Kleppmann — "How to do distributed locking" (Redlock 비판)

**문제 제기**:
- Redis의 **Redlock 알고리즘**이 "분산 락의 표준"처럼 받아들여지는데, 정말 안전한가?

**핵심 지적**:
1. **GC pause 동안 락이 만료되면** 원래 소유자가 락을 놓은 줄 모르고 작업을 계속함 → 다른 클라이언트가 획득 → 이중 처리
2. **시계 동기화(NTP)에 의존**하는 설계 — NTP 점프나 시스템 시간 조작 시 락 타이밍 깨짐
3. **네트워크 지연**이 TTL을 초과하면 이미 만료된 락으로 작업 계속

**해결 제안**:
- **Fencing Token**: 락 획득 시 단조 증가 토큰 발급 → DB UPDATE 시 `WHERE token > last_known_token` 조건으로 "오래된 요청 차단"
- 또는 **ZooKeeper/etcd 같은 합의 기반** 분산 락 사용 (성능은 느리지만 안전)

**교훈**: **"분산 락은 '효율을 위한 최선의 노력(best effort)'이지 '정확성 보장'이 아니다."** 정합성이 절대적이면 fencing 또는 consensus 기반.

출처: https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html

---

### 📌 사례들을 관통하는 공통 패턴

공개된 모든 사례를 종합하면 **"같은 5가지 방어선"** 의 조합입니다:

| 방어선 | 목적 | 대표 사례 |
|--------|------|----------|
| **1. Edge Throttling** | DB 도달 전 트래픽 제한 | Shopify leaky bucket |
| **2. Idempotency Key** | 중복 요청을 클라이언트에서 식별 | Stripe, Airbnb |
| **3. 분산 락** | 동시 진입 자체 차단 | 우아한형제들, 토스, 컬리 |
| **4. DB 레벨 락 / Optimistic Lock** | 마지막 쓰기 단계의 정합성 검증 | 토스 (CAS), Airbnb (row lock) |
| **5. 사후 Reconciliation / Idempotency Table** | 중복 발생 시 사후 감지/복구 | Airbnb Orpheus, Stripe 스토리지 |

**이 실험(이슈 #4)은 (3)과 (4)의 필요성을 증명**하는 것이고, 실제 운영에서는 (1), (2), (5)도 함께 조합되어야 **진짜 안전한 시스템**이 됩니다.

### 🎤 면접 활용 포인트

> "저희 시스템의 Redis SETNX 기반 락은 Shopify, 우아한형제들, 컬리 등의 공개 사례와 같은 계열입니다. 다만 Kleppmann의 RedLock 비판을 읽고 fencing token을 검토했는데, 저희 워크로드에서는 '외부 API 재확인 + DLQ'가 더 실용적 방어선이라 판단해 도입하지 않았습니다. 금융급 정합성이 필요하면 토스증권처럼 분산 락 + @Version CAS 패턴을, 외부 결제라면 Stripe/Airbnb처럼 idempotency key 레이어를 추가하는 게 맞습니다."

이 한 문단으로 **"이론 → 공개 사례 → 본인 판단"**의 3단 논리를 보여줄 수 있습니다.

</details>

<details>
<summary><b>🔍 깊게 파기 #8 — Dirty Checking은 왜 필요한가? 정합성 문제가 있는데도 쓰는 이유</b></summary>

### 8-A. 먼저 오해 정정 — Lost Update는 Dirty Checking의 버그가 아니다

Lost Update는 Dirty Checking이 만든 문제가 **아닙니다**. 이건 **Read-Modify-Write 패턴 자체의 구조적 문제**이고, JDBC로 직접 써도 똑같이 발생합니다:

```java
// JDBC로 직접 쓴 코드 — Dirty Checking 전혀 없음
try (Connection conn = dataSource.getConnection()) {
    conn.setAutoCommit(false);

    // 1) SELECT
    PreparedStatement s = conn.prepareStatement(
        "SELECT retry_count FROM reply_requests WHERE id = ?");
    s.setLong(1, 1L);
    ResultSet rs = s.executeQuery();
    rs.next();
    int current = rs.getInt("retry_count");   // 0

    // 2) Modify (메모리)
    int next = current + 1;                   // 1

    // 3) UPDATE
    PreparedStatement u = conn.prepareStatement(
        "UPDATE reply_requests SET retry_count = ? WHERE id = ?");
    u.setInt(1, next);
    u.setLong(2, 1L);
    u.executeUpdate();

    conn.commit();
}
// 여러 스레드가 이걸 동시에 실행하면 → Lost Update 발생. Dirty Checking과 무관.
```

**결론**: Lost Update의 원인은 **"두 트랜잭션이 같은 시점의 DB를 읽어서 각자 새 값을 덮어쓴다"**는 패턴 자체이지, Hibernate/Dirty Checking이 아닙니다.

### 8-B. 그럼 Dirty Checking의 존재 이유는?

Dirty Checking의 설계 목적은 **정합성 보장이 아니라 "쓰기 편의성 + Transaction 일관성"** 입니다. 구체적으로 6가지:

#### (1) 개발자 경험(DX) — setter만 호출하면 끝

```java
// Dirty Checking 없이 (전통 JDBC/MyBatis)
ReplyRequest req = repo.findById(1L);
req.markProcessing();
repo.update(req);  // ← 이걸 까먹으면 변경 사라짐

// Dirty Checking 있으면 (JPA)
ReplyRequest req = repo.findById(1L);
req.markProcessing();  // 끝. 트랜잭션 종료 시 자동 flush
```

→ "도메인 객체만 조작하고 저장은 잊어라"가 가능해져 **OOP에 가까운 코드**를 쓸 수 있음.

#### (2) Write-Behind — 중간 변경 여러 번을 UPDATE 한 번으로

```java
@Transactional
public void processReplyAndFinish(Long id) {
    ReplyRequest req = repo.findById(id);
    req.markProcessing();        // retry_count = 1
    // ... 외부 API 호출 ...
    req.markCompleted();          // status = COMPLETED
    req.setCompletedAt(now());    // completed_at = ...
}
// UPDATE는 딱 1번: status, retry_count, completed_at 모두 한 번에
```

→ 네트워크 round-trip 최소화. JDBC 직접 쓰면 UPDATE 3번 날리기 쉬움.

#### (3) 변경 없으면 UPDATE 자체를 생략

```java
@Transactional
public ReplyRequest getReply(Long id) {
    return repo.findById(id);  // 조회만 하면 UPDATE 안 나감
}
```

→ `save()`를 실수로 호출해도 내용이 같으면 SQL 생략. JDBC에선 `UPDATE ... WHERE id=?`가 의미 없이 나감.

#### (4) 트랜잭션 경계 내 "쓰기 일관성"

1차 캐시 + flush 구조 덕분에:
- 같은 트랜잭션 내에서 같은 ID 조회하면 **항상 같은 객체 인스턴스** (`==` 비교 통과)
- 한 엔티티를 여러 곳에서 수정해도 마지막에 **하나의 UPDATE**로 정리
- 객체 그래프의 변경이 커밋 시점에 일관된 순서로 반영

#### (5) Interceptor / Entity Listener 훅 제공

```java
@Entity
@EntityListeners(AuditListener.class)
public class ReplyRequest {
    @PreUpdate void beforeUpdate() { ... }
    @PostUpdate void afterUpdate() { ... }
}
```

→ Dirty Checking 덕분에 **"변경이 감지되는 시점"**을 훅으로 잡을 수 있음. 감사 로그, 이벤트 발행, 버전 관리 등에 활용.

#### (6) 성능 최적화 여지

- `@DynamicUpdate`: 변경된 필드만 UPDATE 컬럼에 포함
- Bytecode Enhancement: state-diff 비용 감소
- Batch flush: 여러 엔티티의 UPDATE를 묶어서 전송

### 8-C. Dirty Checking과 정합성은 '직교(orthogonal)'한다

두 축을 혼동하면 안 됩니다:

```
              정합성 축 (동시성 대응)
                    │
   Serializable ────┤──── 기본 락 없음
                    │         ↑
                    │       기본값
                    │
   ─────────────────┼───────────────── 쓰기 편의성 축
                    │
   JDBC 직접        │       Dirty Checking
   (수동 update)    │       (자동 flush)
```

| | JDBC 직접 쓰기 | Dirty Checking (JPA) |
|---|:---:|:---:|
| **Lost Update 가능성** | 있음 | 있음 |
| **정합성 기본 제공** | 없음 | 없음 |
| **쓰기 편의성** | 낮음 | 높음 |
| **정합성 보강 수단** | 락, `@Version`, SERIALIZABLE | 동일 |

**핵심**: "Dirty Checking을 쓰든 JDBC를 쓰든 정합성은 **별도로** 설계해야 한다." 둘은 해결하는 문제가 다름.

**비유**:
- Dirty Checking = **자동 변속기** (운전이 편해짐)
- 락 = **안전벨트** (사고 방지)
- 둘 다 필요하고, 자동 변속기를 쓴다고 안전벨트를 안 매도 되는 게 아님

### 8-D. 그럼 언제 Dirty Checking을 '쓰지 말아야' 하나?

Dirty Checking의 비용이 이득을 넘는 상황:

1. **대량 벌크 UPDATE**: 수백만 건을 한 번에 처리할 때는 JPQL/native bulk update가 훨씬 빠름
   ```java
   // 이건 JPA로 하면 엔티티 100만 개 로드 + 100만 번 스냅샷 비교 → 죽음
   em.createQuery("UPDATE ReplyRequest r SET r.status = :s WHERE ...")
     .setParameter("s", FAILED)
     .executeUpdate();
   // 이게 훨씬 빠름 (단점: 1차 캐시 동기화 필요)
   ```

2. **고빈도 카운터**: 조회수, 좋아요 등은 Redis INCR이 정답

3. **이벤트 소싱**: 상태 스냅샷이 아니라 이벤트 로그로 관리하는 패턴

4. **read-heavy + 락 경합 심함**: 읽기만 JPA로, 쓰기는 명시적 stored procedure 또는 원자적 SQL
   ```sql
   -- 이게 Lost Update를 근본적으로 막는 "상대 연산"
   UPDATE reply_requests SET retry_count = retry_count + 1 WHERE id = ?
   ```

### 8-E. 면접에서의 정답 문장

> **"Dirty Checking은 '정합성 보장 도구'가 아니라 '쓰기 편의성 도구'입니다. Lost Update는 Dirty Checking의 버그가 아니라 read-modify-write 패턴 자체의 한계고, JDBC로 직접 써도 동일하게 발생합니다. 정합성은 `@Version`, 비관적 락, 분산 락 같은 별도의 축에서 선택적으로 보강해야 하고, 두 축이 직교하기 때문에 Dirty Checking의 이점(DX, write-behind, listener hook)을 유지하면서 정합성을 원하는 구간에만 락을 거는 게 실무 표준입니다."**

이 답변이 "Dirty Checking이 문제 아니냐?"는 함정 질문을 **설계 이해도로 역공**할 수 있는 포인트입니다.

</details>

---

### [꼬리질문] "1차 캐시는 어떤 자료구조로 되어있나요?"

**L4 심화**

> "Hibernate의 `StatefulPersistenceContext`는 **엔티티 키 기준의 Map 여러 개**로 구성됩니다. 한쪽은 `엔티티 키 → 엔티티 객체`, 다른 쪽은 `엔티티 키 → EntityEntry(로드 시점 스냅샷과 상태)`를 추적합니다. 엔티티 키는 엔티티 타입과 식별자를 기준으로 만들어진 내부 키 구조입니다.
>
> 하나의 `@Transactional` 범위 내에서 같은 ID로 `findById`를 두 번 부르면 두 번째는 DB를 안 가고 1차 캐시에서 바로 반환됩니다. **DB 격리 수준의 REPEATABLE READ와는 다른 메커니즘**이고, 애플리케이션 관점에서 같은 트랜잭션 내 동일 객체를 반복 참조하는 효과를 냅니다. 실험에서는 각 스레드가 **독립된 트랜잭션 = 독립된 Persistence Context**라서 1차 캐시가 공유되지 않고, 각자 DB에서 따로 SELECT합니다."

### [꼬리질문] "그 동일 객체 보장이 실무에서 구체적으로 왜 이득인가요?"

**L4 심화 — 동일성(Identity) 보장의 실전 가치**

> "두 가지 실전 이득이 있습니다. **같은 트랜잭션 내 자기 Lost Update 방지**와 **서비스 레이어 분리 시 쓰기 일관성**입니다."

#### (1) 동일성 vs 동등성 — 무엇이 보장되나

```java
@Transactional
public void demo(Long id) {
    ReplyRequest a = replyRepo.findById(id);  // DB SELECT → 객체 A 생성
    ReplyRequest b = replyRepo.findById(id);  // 1차 캐시 HIT → 객체 A 그대로 반환

    System.out.println(a == b);         // true (동일성: 같은 메모리 주소)
    System.out.println(a.equals(b));    // true (동등성)

    a.markProcessing();                  // a.retryCount = 1
    System.out.println(b.getRetryCount());  // 1 (a와 b는 같은 객체!)
}
```

> **JPA는 `==`(동일성)까지 보장**합니다. 일반적인 ORM/JDBC는 `.equals()`(동등성)만 보장하거나 아무것도 보장하지 않습니다.

#### (2) 1차 캐시가 없으면 같은 트랜잭션 안에서도 Lost Update가 난다

```java
// 1차 캐시 없는 JDBC 스타일
@Transactional
public void noCacheScenario(Long id) {
    ReplyRequest a = jdbcSelect(id);   // 새 객체 A (retryCount=0)
    ReplyRequest b = jdbcSelect(id);   // 새 객체 B (retryCount=0, 별개 인스턴스)

    a.setLocked(true);                  // A만 바뀜
    b.markProcessing();                 // B만 바뀜 (locked는 여전히 false)

    jdbcUpdate(a);   // UPDATE SET locked=true, retryCount=0
    jdbcUpdate(b);   // UPDATE SET locked=false, retryCount=1  ← A의 locked 변경이 사라짐!
}
```

> **같은 트랜잭션 내에서 자기 자신을 Lost Update** 하는 황당한 버그가 JDBC에선 흔합니다. JPA는 같은 객체를 공유하니까 구조적으로 방지됩니다.

#### (3) 서비스 레이어가 나뉘어도 변경이 누적된다

```java
@Transactional
public void processReplyFully(Long id) {
    validationService.validate(id);      // 내부 findById(id) → 같은 객체 반환
    lockService.markLocked(id);          // 내부 findById(id) → 같은 객체, setLocked(true)
    scraperClient.register(id);
    completionService.markCompleted(id); // 내부 findById(id) → 같은 객체, markCompleted()
}
```

| | 1차 캐시 없음 | 1차 캐시 있음 (JPA) |
|---|---|---|
| **DB SELECT 횟수** | 4회 | **1회** |
| **자바 객체 개수** | 4개 (별개) | **1개 (공유)** |
| **변경 누적 방식** | 각자 다른 객체를 수정 → 충돌 | 같은 객체에 누적 → 일관 |
| **UPDATE 발행** | 4번 (마지막 값이 이김) | **1번** (모든 변경 통합) |

> **핵심**: 서비스 분리를 해도 엔티티 수정의 최종 결과가 **원자적으로 하나의 UPDATE**에 담깁니다.

#### (4) 영속성 컨텍스트 범위 — '애플리케이션 레벨 Repeatable Read'

```java
@Transactional
public void appLevelRepeatableRead(Long id) {
    ReplyRequest r1 = replyRepo.findById(id);
    // → 여기서 다른 트랜잭션이 DB의 retry_count를 999로 바꾸고 커밋했다고 가정

    ReplyRequest r2 = replyRepo.findById(id);
    // → 여전히 1차 캐시에서 반환, retry_count는 원래 값 그대로
}
```

| | DB `REPEATABLE READ` | JPA 1차 캐시 |
|---|---|---|
| **동작 레이어** | DB 엔진 (MVCC + undo log) | 애플리케이션 메모리 (Map) |
| **보장하는 것** | 같은 SELECT 쿼리 결과의 일관성 | 같은 ID 조회의 **객체 인스턴스 동일성** |
| **DB 조회 횟수** | 매번 DB 호출 | 첫 1번만 DB, 이후 캐시 |
| **범위** | 트랜잭션 전체 | 영속성 컨텍스트(세션) 전체 |

#### (5) 정리 — 면접에서 답하는 한 문단

> "JPA는 같은 영속성 컨텍스트 안에서 같은 ID 조회 시 **항상 같은 자바 객체 인스턴스**를 반환합니다. `==` 비교까지 true라서 서비스 레이어가 여러 메서드로 나뉘어 같은 엔티티를 다뤄도 **모든 변경이 하나의 객체에 누적**되고, 트랜잭션 종료 시 **하나의 UPDATE로 통합 반영**됩니다. JDBC로 직접 쓰면 같은 ID 조회가 매번 새 객체를 반환해서 같은 트랜잭션 안에서도 자기 자신과 Lost Update가 날 수 있는데, JPA는 1차 캐시로 이를 구조적으로 방지합니다. 이건 DB 격리 수준의 REPEATABLE READ와는 다른 **애플리케이션 레벨의 일관성**입니다."

---

## Q2. 격리 수준과 InnoDB 락

### [면접관] "MySQL은 기본 REPEATABLE READ인데, 그럼 Lost Update 막아주는 거 아닌가요?"

**L2 — 원리 답변**

> "아닙니다. REPEATABLE READ가 보장하는 건 **'같은 트랜잭션 내 같은 쿼리는 항상 같은 결과를 본다'** 뿐입니다. MVCC 스냅샷으로 구현되어 있어서 일반 SELECT는 트랜잭션 시작 시점의 데이터를 보는 거고, 그 사이 다른 트랜잭션이 커밋해도 내 시야에는 안 보입니다.
>
> 이건 **읽기 일관성**이지 **쓰기 직렬화**가 아닙니다. Lost Update를 막으려면 SERIALIZABLE로 올리거나 명시적 락이 필요합니다."

### [꼬리질문] "InnoDB가 Row Lock 기반인데, UPDATE에는 X-lock 걸리잖아요. 그게 Lost Update 막는 거 아닌가요?"

**L3 — 트레이드오프**

> "X-lock은 **순서를 직렬화**하지만 **내용의 정합성을 검증하지 않습니다**. 예를 들면:

```
T1: SELECT retry_count = 0 (락 없음, MVCC)
T2: SELECT retry_count = 0 (락 없음, MVCC)
T1: UPDATE SET retry_count = 1 (X-lock 획득, 성공)
T1: COMMIT → DB = 1
T2: UPDATE SET retry_count = 1 (T1 대기 → X-lock 획득)
   ↑ 이 시점에 T2는 "DB가 뭐든 간에 1로 써라"라고 명령함
T2: COMMIT → DB = 1 (T1 변경 덮어씀)
```

X-lock은 T2가 T1을 기다리게 만들었지만, T2가 **'현재 DB 값이 뭔지 재확인하는 단계'**가 없습니다. 자기가 아는 메모리 상태로 덮어쓸 뿐입니다.

> 정확히 말하면, **일반 SELECT가 locking read가 아니라서** Lost Update가 발생합니다. 읽기 경로를 세 가지로 분리해 보면 명확합니다:
>
> - **일반 SELECT** (MVCC consistent read): 어떤 트랜잭션이 X-lock을 갖고 있어도 자기 스냅샷을 락 없이 그대로 읽음. 이게 우리 시나리오의 T1/T2가 동시에 `retry_count=0`을 읽을 수 있는 이유.
> - **`SELECT ... FOR UPDATE`** (locking read): 명시적 X-lock 획득. 같은 행을 lock read로 잡은 다른 트랜잭션이 있으면 대기. 일반 SELECT는 여전히 MVCC로 통과하지만, 이 경로로 들어오는 트랜잭션끼리는 직렬화됨.
> - **SERIALIZABLE + autocommit off**: 일반 SELECT도 사실상 locking read로 동작해 직렬 실행에 가까워짐.
>
> 따라서 이 시나리오에서 `T2: SELECT FOR UPDATE`를 썼다면, **T2의 locking read**가 T1이 보유한 X-lock을 기다렸다가 T1 커밋 후 갱신된 값(1)을 읽어 `retry_count=2`로 UPDATE했을 것입니다. 다만 '일반 SELECT까지 막히는 건 아니다'는 점을 구분해서 말해야 합니다."

### [꼬리질문] "그럼 SERIALIZABLE로 올리면 해결되죠? 왜 기본값을 그걸로 안 하나요?"

**L3 — 트레이드오프 심화**

> "SERIALIZABLE에서는 **일반 SELECT도 동시 쓰기와 더 강하게 충돌하도록 동작**합니다. InnoDB의 경우 autocommit이 비활성화된 상태에서 일반 SELECT가 사실상 locking read에 가깝게 처리되어 직렬 실행에 근접합니다. Lost Update는 막히지만 대가가 큽니다.
>
> - **읽기-쓰기 충돌 증가**: 같은 행을 읽는 동안 다른 트랜잭션이 쓸 수 없음
> - **Deadlock 빈도 급증**: 락 그래프가 복잡해져 탐지 + 재시도 비용 증가
> - **대기 시간 누적**: 읽기 TPS가 수 배~수십 배 희생될 수 있음
>
> 그래서 업계 표준은 **'격리 수준은 REPEATABLE READ/READ COMMITTED 유지, 정합성이 필요한 구간에만 명시적 락'** 입니다. 이 실험도 그 전제에서 출발합니다.
>
> (참고로 구체 TPS 수치는 워크로드마다 편차가 커서 '예시'일 뿐이고, 면접에서 단정적으로 수치를 말하면 역공 받기 쉽습니다.)"

### [꼬리질문] "InnoDB의 MVCC는 구체적으로 어떻게 구현되어 있나요?"

**L4 — CS 심화**

> "InnoDB는 각 행에 **숨은 컬럼 3개**를 관리합니다:
>
> - `DB_TRX_ID` (6바이트): 이 버전을 만든 트랜잭션 ID
> - `DB_ROLL_PTR` (7바이트): 이전 버전의 undo log 주소
> - `DB_ROW_ID` (6바이트): PK 없을 때 자동 생성
>
> 트랜잭션이 SELECT를 날리면 InnoDB가 `ReadView`를 생성합니다. `ReadView`는 4가지 정보를 담습니다:
>
> - `m_ids`: SELECT 시점에 active한 트랜잭션 ID 목록
> - `min_trx_id`: m_ids 중 최솟값
> - `max_trx_id`: 다음에 할당될 트랜잭션 ID
> - `creator_trx_id`: 이 ReadView를 만든 트랜잭션
>
> 각 행을 읽을 때 InnoDB가 `DB_TRX_ID`를 `ReadView`와 비교:
> - `DB_TRX_ID < min_trx_id`: 이미 커밋됨, 내가 봐도 됨
> - `DB_TRX_ID >= max_trx_id`: 나보다 나중에 시작됨, 무시
> - `DB_TRX_ID ∈ m_ids`: 아직 active, undo log 따라가서 이전 버전 읽음
>
> 이 메커니즘이 **락 없는 읽기(non-blocking read)**를 가능케 합니다. ReadView 생성 시점은 격리 수준마다 다른데, **REPEATABLE READ는 트랜잭션의 첫 consistent read 시점에 1번 생성해서 트랜잭션 동안 재사용**하고, **READ COMMITTED는 매 consistent read마다 새로 생성**합니다. 그래서 REPEATABLE READ에서는 같은 SELECT가 같은 결과를 주고, READ COMMITTED에서는 중간에 다른 트랜잭션의 커밋이 보일 수 있습니다.
>
> 재미있는 건 이 MVCC가 undo log를 계속 생산해서 **긴 트랜잭션이 열려있으면 undo log가 GB 단위로 쌓입니다**. `SHOW ENGINE INNODB STATUS`에서 `History list length`로 감지하고, 저는 이걸 Prometheus로 모니터링해서 1시간 이상 열린 트랜잭션은 알람이 가게 해뒀습니다."

---

## Q3. 왜 정확히 12~13으로 수렴?

### [면접관] "실험 결과가 3회 모두 10~13 사이네요. 100/20 = 5가 나올 것 같은데 왜 이 숫자가 나오죠?"

**L2 — 원리 답변**

> "HikariCP max=20이니 **'한 라운드에 20개 스레드가 경쟁 → 1개만 성공 → 5라운드면 증가분 5'** 라는 단순 모델은 맞지 않습니다. 실제로는 3가지 현상이 겹칩니다.
>
> **첫째**, 커넥션 획득이 micro-second 단위로 분산됩니다. 100개 스레드가 동시에 시작해도 실제 UPDATE 대기 큐에 들어가는 타이밍은 균일하지 않아요.
>
> **둘째**, 빠르게 끝난 스레드가 커넥션을 반납하면 다음 스레드가 즉시 잡습니다. '라운드'라는 개념이 깔끔하게 구분되지 않고 물결처럼 진행됩니다.
>
> **셋째**, 일부 스레드는 늦게 SELECT를 수행해서 이미 몇 차례 업데이트된 값을 읽습니다. 이 경우 올바른 증가분이 추가됩니다.
>
> 결과적으로 '평균 동시 UPDATE 대기 큐 길이'가 일정 범위에서 안정화되고, 100번의 호출 중 일부만 'DB에 반영된 값을 기반으로 한 증가'로 이어지는 패턴이 됩니다.
>
> **⚠️ 면접 대응 주의**: 지금 설명은 **관찰한 결과에 대한 가설적 모델**이고, 정확한 원인을 확정하려면 (1) HikariCP의 커넥션 획득 타임스탬프, (2) Hibernate flush 시점, (3) InnoDB lock wait 기록을 trace로 수집해 분석해야 합니다. 실험에서 확실하게 말할 수 있는 건 **'풀 크기 자체가 아니라 실제 SELECT 시점의 분산 패턴이 결과를 결정한다'**는 점, 그리고 **'같은 환경에서는 결과가 재현된다'**는 점입니다."

### [꼬리질문] "그럼 HikariCP max를 늘리면 어떻게 될까요?"

**L3 — 반직관적 트레이드오프**

> "이게 이 실험에서 가장 흥미로운 관찰인데, **커넥션 풀을 키우면 정합성이 더 나빠집니다.**
>
> | HikariCP max | 최종 retry_count (예상) | 해석 |
> |---|:---:|---|
> | 1 | 100 | 완벽 직렬화 — 락 없어도 순차 실행 |
> | 20 (현재, 실측) | 10~13 | 3회 측정 중앙값 12 |
> | 100 이상 | 1에 가까워짐 (예상) | 모두가 같은 값을 읽고 같은 값으로 덮어쓰는 비중↑ |
>
> (풀 크기 100, 1000은 직접 재측정하지 않은 **예상 방향**이고, 정확한 값은 환경에 따라 달라집니다.)
>
> 이게 중요한 이유는 실무에서 **'TPS 안 나와서 HikariCP max를 늘리자'** 라는 흔한 튜닝이 있는데, **정합성 문제가 있는 코드에서는 오히려 상황을 악화시킨다**는 겁니다.
>
> 원칙: **'커넥션 풀은 성능 튜닝 수단이지, 정합성 수단이 아니다'**. 정합성은 락으로 풀고, 스케일은 DB + 커넥션 풀로 풉니다. 두 축이 독립적이어야 합니다."

### [꼬리질문] "InnoDB X-lock의 대기 큐는 어떤 알고리즘인가요? FIFO인가요?"

**L4 — CS 심화 (정확히 아는 만큼만)**

> "**FIFO라고 단정하기 어렵습니다.** InnoDB는 버전별로 락 스케줄링 정책이 달라졌는데, 최근 MySQL 8.0에서는 `innodb_lock_schedule_algorithm`으로 CATS(Contention-Aware Transaction Scheduling) 같은 새로운 정책이 들어왔습니다. 락 호환성도 고려해서 S-lock이 연달아 있으면 한꺼번에 깨우는 등 단순 FIFO는 아닙니다.
>
> 실험에서 관찰한 건 **'같은 환경에서 반복 실행 시 비슷한 결과로 수렴한다'**는 점이지, InnoDB가 정확히 어떤 순서로 락을 부여하는지를 증명하지는 않습니다. 정확한 스케줄링 관찰은 `performance_schema.data_locks`와 `data_lock_waits` 뷰로 추적해야 하고, 이 실험 범위에선 하지 않았습니다.
>
> 수치가 10~13으로 수렴한 건 **플랫폼(M2 Pro)의 스레드 스케줄링, HikariCP 획득 순서, InnoDB 락 큐 정책**이 결합된 결과이고, 다른 환경(Linux 서버, ARM 등)에서는 다른 숫자가 나올 수 있음을 전제로 해석해야 합니다."

---

## Q4. 외부 API 이중 호출 — 분산 시스템의 본질

### [면접관] "retry_count만 Lost된 거면 숫자만 틀린 거잖아요. 큰 문제예요?"

**L1 — 본질 답변**

> "**retry_count가 아니라 외부 API 호출이 본질입니다.**
>
> 실험 결과를 보면 DB의 retry_count는 12번만 증가했지만, processReply 메서드 자체는 100번 전부 실행됐습니다. 이 메서드 내부에 외부 플랫폼 스크래퍼 호출이 있다고 가정하면, **스크래퍼는 이미 100번 호출된 상태**입니다. 사장님이 보는 답글은 100개가 중복 등록되어 있고요."

**L2 — 원리 답변**

```java
@Transactional
public void processReply(Long id) {
    ReplyRequest req = repo.findById(id);
    req.markProcessing();           // [A] DB 변경 — 트랜잭션 atomic set 포함
    
    scraperClient.register(req);    // [B] 외부 HTTP 호출 — 실행 흐름은 안,
                                    //     DB 트랜잭션의 원자적 롤백 대상은 아님
    
    req.markCompleted();            // [C] DB 변경
}
// @Transactional 롤백되어도 [B]는 이미 일어난 상태이며 되돌릴 수 없음
```

> "@Transactional의 ACID 보장은 **DB 범위에서만 유효**합니다. 분산 트랜잭션(XA)이 없는 한 외부 HTTP 호출은 메서드 실행 흐름상 트랜잭션 안에 있어도 **DB 트랜잭션의 원자적 롤백 집합에는 포함되지 않습니다**. 그래서 '트랜잭션이 있다'는 착각이 더 위험합니다."

### [꼬리질문] "이게 바로 Two Generals' Problem 맞죠?"

**L4 — 분산 시스템 이론 (정밀하게)**

> "결이 닿아있지만 정확히는 다릅니다. **Two Generals' Problem은 '비동기 네트워크에서 양측이 확실히 합의할 수 없다'는 불가능성 증명**이고, 이 사례는 그 증명을 1:1로 대입하는 것보다는 **'at-least-once 처리 환경에서 외부 부작용이 있는 작업의 멱등성 문제'**로 부르는 게 실무적으로 정확합니다.
>
> 본질은 같습니다: 네트워크 너머 작업 결과가 불확실한 상태에서 재시도를 해야 하고, 그래서 **멱등성 설계가 핵심**입니다.
>
> - HTTP 호출 후 응답이 안 오면: 성공? 실패? 네트워크 끊김? 모름
> - 재시도하면: 중복 호출 위험
> - 재시도 안 하면: 유실 위험
>
> 이 딜레마를 푸는 방법은 3가지:
>
> 1. **작업 자체가 멱등**: `SET x = 5` (여러 번 실행해도 결과 같음)
> 2. **멱등성 키**: 클라이언트가 고유 키를 보내고, 서버가 '이 키는 이미 처리됨' 체크
> 3. **외부 상태 조회**: 호출 전/후에 '이미 등록됐는지' 조회해서 판단
>
> 배달 플랫폼 API는 대부분 **1번이 아닙니다** (답글 등록은 여러 번 하면 여러 개 됨). 멱등성 키를 지원하는 플랫폼도 있고 아닌 것도 있어서, 저희 시스템은 **3번 + 락의 이중 방어**로 풀었습니다."

### [꼬리질문] "그럼 Saga 패턴이나 2PC는 안 쓰는 이유는요?"

**L4/L5 — 아키텍처 판단 (우선순위 명확히)**

> "**2PC (Two-Phase Commit)**는 외부 플랫폼이 XA 프로토콜을 지원해야 쓸 수 있는데, 배달 플랫폼 API는 지원 안 합니다. 일반 REST API일 뿐이라 2PC는 애초에 선택지에서 빠집니다.
>
> **Saga도 불채택**인데, 결정타는 **순서대로 다음 세 가지**입니다:
>
> 1. **[가장 결정적] 보상 API 부재 — 롤백 자체가 불가능**: 플랫폼마다 '답글 삭제' API가 없거나 비공식이거나 수동 작업만 가능한 경우가 많습니다. 보상 트랜잭션을 쓸 수 없는데 Saga를 택하는 건 무의미합니다.
> 2. **사용자 가시성 문제**: 사장님 입장에서 '답글이 달렸다 → 몇 초 뒤 사라짐'은 '처음부터 실패'보다 UX가 더 나쁩니다. 최종 일관성이 비즈니스에 안 맞습니다.
> 3. **오케스트레이션 운영 비용**: 상태 머신, 보상 재시도, 타임아웃 관리가 추가 인프라를 요구합니다.
>
> **실제 채택한 구조**: 강한 락(Redis SETNX)으로 중복 자체를 방지 + 호출 후 외부 플랫폼 조회로 이중 검증 + 실패 시 DLQ로 격리해 수동 판정. **'100% 보장이 불가능하면 최선은 중복 발생 확률을 낮추고, 발생 시 빠르게 감지·복구하는 것'**으로 복잡도를 조정했습니다."

---

## Q5. 낙관 vs 비관 락, 그리고 현실의 선택

### [면접관] "`@Version`으로 낙관적 락 거는 게 가장 간단하잖아요. 왜 그거 안 쓰나요?"

**L2 — 원리 답변**

**`@Version` 동작**:
```sql
-- JPA가 자동 생성
UPDATE reply_requests 
SET retry_count = 1, version = 2
WHERE id = 1 AND version = 1
-- 0 rows affected → OptimisticLockingFailureException
```

> "@Version은 '내가 읽은 버전에서 DB가 안 바뀌었는가'를 UPDATE의 WHERE 절로 검증합니다. 바뀌었으면 `OptimisticLockingFailureException` 예외가 발생하고, 애플리케이션이 재시도하든지 포기하든지 결정해야 합니다."

**L3 — 트레이드오프 분석**

| | 낙관적 (`@Version`) | 비관적 (`FOR UPDATE`) | 분산 락 (Redis) |
|---|---|---|---|
| 락 획득 시점 | 없음 (쓸 때만 검증) | SELECT 시점 | 별도 Redis 호출 |
| 실패 처리 | 예외 → 재시도 | 대기 (타임아웃) | 대기 or 즉시 실패 |
| DB 커넥션 점유 | 짧음 | 김 (비즈니스 로직 동안) | 짧음 |
| 적합한 워크로드 | **충돌이 드문 경우** (일반적으로) | DB 내에서 짧게 끝나는 **고충돌 구간** | **외부 I/O를 동반한 장시간 작업** |
| 처리 시간 | 짧을 때 유리 | 짧을 때 유리 | 긴 작업에 유리 |

> ⚠️ "충돌 빈도 X% 이하/이상" 같은 절대 임계값은 워크로드마다 달라서 근거 없이 단정하면 면접에서 역공 받습니다. **'일반적으로'**라는 수준으로만 답하고, 정확한 임계는 측정해야 한다고 덧붙이는 게 안전합니다.

### [꼬리질문] "이 실험의 도메인 — 스크래퍼가 p99 25초 걸리는 상황 — 에서는 어떤 선택이 맞을까요?"

**L4 — 실전 판단**

> "**분산 락이 맞습니다.** 이유를 구체적으로 말씀드리면:
>
> **@Version은 부적합**:
> - 25초 짜리 외부 호출이 진행 중인데, 그 사이 다른 재시도가 들어오면 version 충돌
> - 예외 발생 → 재시도 → 또 충돌 → 재시도... 충돌률이 높을 때 livelock 가능
> - 대량 재처리 시점에 충돌률이 크게 올라가면 낙관적 락 재시도가 이걸 못 견딤
>
> **비관적 락(`FOR UPDATE`)도 부적합**:
> - SELECT FOR UPDATE로 잡는 순간 해당 row에 X-lock 걸림
> - 스크래퍼 호출이 25초 걸리는 동안 **DB 커넥션과 row lock을 25초 보유**
> - HikariCP max=20인데 100개 요청이 쌓이면 커넥션 고갈 → 전체 API 응답 불가
> - **DB 커넥션이 네트워크 I/O 대기 시간에 묶이는 게 최악의 패턴**
>
> **분산 락 (Redis SETNX 기반)**:
> - 락은 Redis에 두고, DB 커넥션은 찰나의 UPDATE에만 점유
> - 스크래퍼 호출 25초 동안 DB 커넥션 풀은 자유
> - 락 TTL은 스크래퍼 타임아웃(30초) + 여유분(5초)로 35초 설정
> - 충돌한 요청은 즉시 '이미 처리 중' 응답으로 조기 반환
>
> 실제 운영은 **Redis의 `SET key value NX EX ttl`** 을 사용한 단순 분산 락 구조이고, Redisson은 비교·학습 대상입니다. 두 선택지의 차이는 다음 질문에서 설명하겠습니다."

### [꼬리질문] "현재 운영은 `SET NX EX`라고 하셨는데, Redisson은 뭐가 다른가요?"

**L4 — 분산 락의 안전성 (편의성 vs 안전성 범위 분리)**

> "두 가지를 분리해서 말씀드리겠습니다. **Redisson이 주는 것**과 **Redisson도 완전히 풀어주지 않는 것**입니다.
>
> **Redisson이 주는 편의성/안전성 일부**:
> - **Watchdog**: 기본 30초 TTL, 작업이 진행 중이면 약 10초마다 자동 연장해서 **긴 작업 중 TTL 만료로 인한 좀비 락**을 줄여줍니다.
> - **Pub/Sub 기반 대기**: 락 해제 시 대기자에게 알림을 보내 polling 없이 효율적으로 재시도.
> - **재진입(reentrant)**: 같은 스레드가 여러 번 획득 가능.
> - **RedLock 옵션**: 멀티 마스터 환경에서 다수 노드에 동시 획득하는 알고리즘을 제공.
>
> **Redisson도 완전히 해결하지 못하는 것**:
> - **TTL 만료 후 늦게 도착한 작업**: watchdog은 락 보유자가 살아 있을 때 TTL을 연장하는 것이지, '이미 만료된 락으로 수행 중인 작업'을 막지는 못합니다. GC pause가 매우 길거나 네트워크가 분할되면 여전히 이중 실행 가능.
> - **Fencing 부재**: Redisson의 일반 락 API는 fencing token을 기본 제공하지 않습니다. 강한 보장이 필요하면 **Fencing Token을 직접 설계**해서 DB UPDATE 시 `WHERE token > ?` 조건으로 검증해야 합니다.
>
> **Martin Kleppmann의 RedLock 비판** 도 알아두면 좋습니다. RedLock은 시계 동기화와 stop-the-world pause의 한계에 영향을 받기 때문에 '모든 상황에서 안전한 분산 락은 불가능'하다는 입장이고, 이에 대한 답은 안전성을 Fencing Token으로 **DB 레벨**에서 보장하는 것입니다.
>
> **제 시스템의 선택**:
> 현재 운영은 `SET NX EX`의 단순 분산 락 + 외부 상태 조회 재확인 + DLQ를 **3중 방어**로 구성합니다. Redisson watchdog의 이점은 **'락 갱신과 대기 효율'** 정도인데, 저희 워크로드에서는 스크래퍼 타임아웃이 명확해서 TTL을 보수적으로 잡고 수동 갱신 없이도 동작합니다. **Fencing이 필요한 시나리오는 별도 설계**(예: 플랫폼별 외부 댓글 ID unique 제약)로 풀고 있고, Redisson을 도입해도 fencing은 여전히 직접 설계해야 해서 **도입으로 얻는 이득 대비 운영 복잡도 증가가 크지 않다고 판단**했습니다."

---

## Q6. 멀티 인스턴스 환경의 함정

### [면접관] "그러면 단순하게 `synchronized` 블록으로 감싸면 해결되지 않나요?"

**L1 — 함정 질문 감지**

> "아니요, 30+ API 인스턴스 환경에서는 `synchronized`가 **의미 없습니다**. `synchronized`는 JVM 내부의 monitor lock이라 다른 프로세스의 스레드를 모릅니다.
>
> 인스턴스 A의 스레드 1과 인스턴스 B의 스레드 1이 동시에 같은 reply를 처리하면, 각자 자기 JVM의 synchronized 블록만 보고 '내가 유일하다'고 착각하고 진입합니다. Lost Update와 외부 API 중복 호출이 그대로 재현됩니다.
>
> 이건 **Issue #5에서 실측으로 증명할 예정**입니다. 단일 인스턴스에서는 synchronized로 막히는데, docker-compose로 2개 인스턴스 띄우면 다시 중복 호출이 나타난다 — 이걸 보여주는 게 목적입니다."

### [꼬리질문] "`ReentrantLock`이나 `StampedLock` 같은 고급 락도 마찬가지죠?"

**L3 — 자바 락 계층 정리**

> "네, **전부 JVM 내부 락**이라 분산 환경에서는 의미 없습니다. 정리하면:
>
> | 락 | 범위 | 특징 |
> |---|---|---|
> | `synchronized` | JVM 1개 | monitor 기반, 자동 해제 |
> | `ReentrantLock` | JVM 1개 | 공정성 옵션, 조건 변수 |
> | `ReadWriteLock` | JVM 1개 | 읽기/쓰기 분리 |
> | `StampedLock` | JVM 1개 | optimistic read 가능 |
> | DB Pessimistic Lock | DB 공유 | `FOR UPDATE`, 강력하지만 커넥션 점유 |
> | Redisson / Redis SETNX | Redis 공유 | 빠르고 가볍지만 Redis 장애 영향 |
> | ZooKeeper / etcd | 클러스터 공유 | 강한 일관성, 느림 |
>
> **선택 기준**:
> - 단일 서버 → JVM 락 (빠름)
> - 다중 서버 + 빠른 락 → Redis 계열
> - 다중 서버 + 강한 일관성 → ZooKeeper/etcd
> - DB 트랜잭션 범위 내 → 비관적 락
>
> 제 시스템은 **Redis 분산 락**을 선택했습니다. 이유는: ① Redis가 이미 세션 저장소로 운영 중이라 인프라 비용 추가 없음, ② 10ms 이하 락 획득, ③ 스크래퍼가 초당 수십 건 처리라 ZooKeeper 수준의 강한 일관성은 과함."

### [꼬리질문] "Redis 자체가 죽으면 어떻게 되나요? SPoF 아닌가요?"

**L5 — 장애 대응**

> "네, 그래서 **Redis Sentinel로 HA 구성**하고 있습니다. Master 1개 + Replica 2개 + Sentinel 3개. Master 장애 시 Sentinel이 failover해서 Replica를 새 Master로 승격합니다. 평균 failover 시간 30초 이내.
>
> **장애 시 운영 정책 (degraded mode)**:
>
> 1. **신규 처리 즉시 중단**: 락 스토어를 신뢰할 수 없는 상태에서 새로 처리하면 중복 발생 가능. 그래서 신규 요청은 '일시 중단' 응답으로 거절.
> 2. **진행 중 작업은 reconciliation 대상으로 편입**: failover 시점에 이미 스크래퍼를 호출 중이던 작업은 '상태 불명' — 완료됐는지 실패했는지 외부 조회로 판정해야 함. 이들을 reply_requests에서 quarantine 플래그로 격리해 배치가 사후 판정.
> 3. **DLQ 방향**: 판정 불가한 요청은 DLQ 테이블에 모아 운영자가 수동 처리. 자동 재시도는 금지 (중복 위험).
> 4. **메트릭/알람**: Redis 헬스체크 실패 즉시 Slack 알람, 처리 중단 시간 집계.
>
> 원칙: **'외부 API 중복 호출의 위험 > 처리 지연의 위험'**이므로, Redis 장애 시 '잠시 멈추는' 쪽을 선택합니다.
>
> **더 강한 일관성 보장이 진짜 필요하다면**, Redis 기반보다 **etcd/ZooKeeper 같은 합의(consensus) 기반 분산 코디네이터**가 정석 선택입니다. RedLock은 Kleppmann 비판 이후 커뮤니티에서도 '안전성보다 편의성 도구'로 평가되고 있어서, 금융 수준의 강한 일관성이 필요하면 raft/paxos 기반이 맞습니다. 저희 워크로드는 거기까지는 불필요해서 Redis + 외부 조회 재확인 + DLQ 조합으로 충분합니다."

---

## Q7. 관측성 — 어떻게 발견하고 증명했나

### [면접관] "이 사고가 실제로 운영에서 어떻게 드러났나요? 에러 로그가 안 나온다면서요."

**L1 — 발견 경로**

> "맞습니다. **에러 로그에는 전혀 안 나타났습니다**. 발견한 경로는:
>
> 1. **CS(고객센터) 컴플레인**: 사장님들이 '같은 답글이 두 번 달렸어요' 리포트
> 2. **일일 reconciliation 배치**: DB의 reply_requests.request_status와 외부 플랫폼 조회 결과를 비교하는 배치가 불일치를 발견
> 3. **Prometheus 대시보드 (보조 지표)**: '전역 스크래퍼 호출 수 / 전역 상태 전이 수' 비율이 정상 범위를 벗어나는 순간 조기 경보
>
> 특히 3번은 **보조 지표**였습니다. 전역 비율만으로는 backlog, timeout, 정상 재시도 때문에 흔들려서 오탐이 많습니다. **최종 판정은 `reply_id` 단위 중복 호출 카운터와 외부 플랫폼 조회 결과**로 합니다. **'에러 없음 ≠ 정상'** 이라는 걸 체감한 후부터 **business-key 단위 중복 탐지 + reconciliation**을 주 지표로 삼고 있습니다."

### [꼬리질문] "구체적으로 어떤 메트릭을 어떻게 Prometheus에 보내나요?"

**L4 — 관측성 설계**

> "메트릭을 **전역 지표**와 **reply_id 단위 중복 탐지 지표**로 분리합니다.
>
> **(A) Micrometer로 전역 지표** — 조기 경보/트래픽 모니터링용:
>
> ```java
> Counter.builder("reply.scraper.requests")
>     .tag("platform", platform)
>     .tag("result", result)  // SUCCESS / FAILURE / TIMEOUT
>     .register(meterRegistry);
>
> Counter.builder("reply.db.status_transition")
>     .tag("from", fromStatus).tag("to", toStatus)
>     .register(meterRegistry);
>
> Timer.builder("reply.scraper.duration")
>     .tag("platform", platform)
>     .register(meterRegistry);
> ```
>
> **(B) reply_id 단위 중복 탐지 (주 지표)**:
> - 스크래퍼 호출 이벤트를 `reply_id, timestamp`로 **Kafka/audit 테이블**에 기록
> - 같은 `reply_id`로 짧은 시간창 내 2회 이상 호출이 있으면 즉시 알람
> - 이 지표는 **business-key 단위**라 전역 비율 오탐에 영향받지 않음
>
> **(C) 락 상태 모니터링 — 단순 count로는 부족**:
>
> ```promql
> # 락 보유 시간 분포 (p99 TTL 초과 주시)
> histogram_quantile(0.99, rate(reply_lock_held_seconds_bucket[5m]))
>
> # 좀비 락 후보: TTL 이상으로 잔존한 락의 age
> reply_lock_age_seconds > reply_lock_ttl_seconds
>
> # owner heartbeat 끊긴 orphan 락 수
> reply_lock_orphan_count
> ```
>
> 단순 `held_count > expected_max` 같은 수치는 정상 부하 변동으로 흔들려서 조기 탐지가 약합니다. **락 age, TTL 잔여시간, owner heartbeat, orphan count**를 조합해서 진짜 좀비 락만 집어냅니다.
>
> 전역 비율(`scraper_calls / completed_transitions`)은 조기 경보 **보조 지표**로만 쓰고, **최종 판정은 reply_id 단위 중복 카운터 + 외부 플랫폼 조회**로 합니다."

### [꼬리질문] "만약 과거 데이터에 Lost Update가 얼마나 쌓였는지 검증하려면 어떻게 하나요?"

**L5 — Reconciliation 전략**

> "**일일 reconciliation 배치**를 만들었습니다. 전날 처리된 reply_requests를 전부 읽어서:
>
> 1. `request_status = COMPLETED`인 건 전체 조회
> 2. 각 reply에 대해 플랫폼 조회 API로 '실제 답글이 N개 달려있는가?' 확인
> 3. N > 1이면 **중복 등록 감지** → 별도 테이블 `reply_duplication_audit`에 적재
> 4. 주단위 리포트로 '중복 등록율' 지표화
>
> 이 reconciliation이 **'락 도입 전/후'를 정량 비교**할 수 있게 해줬습니다:
>
> | | 락 도입 전 | 락 도입 후 |
> |---|---|---|
> | 일 평균 중복 등록 | 약 2% | 0.01% 미만 |
> | CS 컴플레인 | 주 5~10건 | 월 1건 미만 |
>
> 이게 **'엔지니어링 의사결정의 비즈니스 가치'** 를 수치로 증명하는 방법이고, 면접에서도 이 수치를 근거로 설명합니다."

---

## Q8. 함정 질문 — 만약 이 상황이라면?

### [면접관] "자, 이런 상황이 실제로 터졌다고 가정해보죠. 프로덕션에서 방금 전 5분간 Lost Update가 감지됐고, 이미 외부 플랫폼에 100건 중복 답글이 등록됐습니다. 뭐부터 하시겠어요?"

**L5 — 사고 대응 시나리오 (Freeze → Scope → Mitigate → Reconcile)**

> "네 단계 프레임워크로 대응합니다: **Freeze(신규 유입 차단) → Scope(영향 범위 판정) → Mitigate(긴급 조치) → Reconcile(사후 복구)**.
>
> **[Freeze] T+0~1분**
> - 알람 수신 즉시 **신규 유입 차단**: feature flag `reply.enable_scraper=false` 활성화로 새 스크래퍼 호출 중단
> - 대기 중인 재시도 요청은 **FAILED 마킹이 아니라 quarantine 상태로 격리** (복구 가능한 정상 요청까지 유실하지 않도록)
> - 원칙: '살릴 수 있는 건 살려두고, 새로 터지는 건 막는다'
>
> **[Scope] T+1~5분**
> - 영향받은 reply ID 범위 확보: `SELECT ... WHERE updated_at > NOW() - INTERVAL 10 MINUTE`
> - reply_id별로 **Redis 락 획득 여부, 스크래퍼 호출 횟수, 외부 플랫폼 실제 등록 수**를 비교
> - 락 없이 처리된 구간과 이중 호출 실제 발생 구간 분리
>
> **[Mitigate] T+5~20분**
> - 근본 원인 추정: Redis 장애 로그 / API 서버 최근 배포 여부 / 스크래퍼 응답 시간 이상
> - 원인에 따라 **롤백 또는 Redis 복구 또는 기능 차단** 중 선택
> - 여전히 확실하지 않으면 **기능 차단 유지**가 안전 (정보 부족 시 보수적 선택)
>
> **[Reconcile] T+1시간~1일**
> - quarantine된 요청을 reconciliation 배치로 판정: 외부 플랫폼 조회 API로 '이미 등록됨/미등록' 분류
> - 이미 중복 등록된 답글은 삭제 스크립트로 정리 (아래 Q 참고)
> - 미등록 건은 락 복구 후 재처리
> - 사장님에게 사과 공지 + 자동 복구 진행 안내
>
> **[Post-mortem] T+1~3일**
> - 타임라인 정리 / Root Cause + Why 5회
> - 재발 방지책: 락 서비스 헬스체크 강화, feature flag 자동화, 알람 지연 단축 등
>
> 핵심 원칙은 **'선 수습 → 재발방지 → 학습'** 순서입니다. 급하다고 원인 추정 전에 코드 수정 배포하면 더 큰 사고로 번집니다. 그리고 **FAILED 마킹은 되돌릴 수 없는 상태 전이라 매우 보수적으로 써야 합니다** — 일단 quarantine으로 보류하고 판정 후에 결정하는 게 안전합니다."

### [꼬리질문] "중복 답글을 삭제하는 스크립트를 짜야 할 때, 어떤 위험을 고려하나요?"

**L5 — 운영 전문성**

> "**이게 더 위험한 작업**입니다. 삭제가 잘못되면 원본 답글까지 지워집니다. 그래서:
>
> 1. **Dry-run 필수**: 실제 삭제 전에 '삭제될 대상 N건'을 로그로 출력, Ops 승인 후 실행
> 2. **Rate limit**: 플랫폼 API rate limit을 지켜서 천천히 (예: 초당 5건)
> 3. **Checkpoint**: 100건마다 중간 상태 저장. 중단되면 그 지점부터 재개
> 4. **Reversibility**: 삭제 전에 원본 답글 내용 + 외부 ID를 별도 테이블에 백업 (복구 필요시 재등록 가능하도록)
> 5. **권한 분리**: 스크립트 실행자와 승인자 분리 (4 eyes principle)
> 6. **Feature flag**: 스크립트 자체도 flag로 on/off 가능하게
> 7. **Audit log**: 모든 삭제 건에 대해 'who, when, why, target' 기록
>
> 그리고 **자동화보다 수동 확인이 나을 때**도 있습니다. 100건 이하면 PM + CS + 엔지니어가 눈으로 확인하고 수동 처리하는 게 안전합니다. 1000건 넘어가면 자동화가 필수고요.
>
> 시니어 레벨에서는 **'어떤 도구를 쓸까'보다 '어떤 리스크를 사전에 제거할까'** 를 먼저 설계합니다."

---

## 핵심 키워드 정리

| 용어 | 한 줄 정의 | 레벨 |
|------|-----------|:---:|
| **Dirty Checking** | 스냅샷과 managed entity 비교로 변경 감지 | L2 |
| **EntityPersister.findDirty / Type.isDirty** | Hibernate의 실제 dirty 계산 경로 | L4 |
| **Persistence Context (1차 캐시)** | 엔티티 키 기준 Map 여러 개로 엔티티·스냅샷 추적 | L4 |
| **MVCC / ReadView** | undo log + 트랜잭션 ID로 락 없이 이전 버전 읽기 | L4 |
| **DB_TRX_ID / DB_ROLL_PTR** | InnoDB의 숨은 MVCC 컬럼 | L4 |
| **ReadView 생성 시점** | RR: 첫 consistent read, RC: 매 consistent read | L4 |
| **History list length** | undo log 누적량 지표, 긴 트랜잭션 감지 | L5 |
| **X-lock / S-lock** | 배타/공유 락 | L4 |
| **InnoDB 락 스케줄링** | 버전별로 다름 (MySQL 8.0+ CATS 등) — 단순 FIFO로 단정하지 말 것 | L4 |
| **REPEATABLE READ** | MySQL 기본 격리, non-blocking read 제공하지만 Lost Update는 안 막음 | L3 |
| **Optimistic Lock (@Version)** | 커밋 시 충돌 감지, 재시도 기반 | L3 |
| **Pessimistic Lock (FOR UPDATE)** | SELECT 시점 즉시 대기 | L3 |
| **HikariCP max-pool-size** | 동시 DB 커넥션 상한 (정합성 수단 아님) | L3 |
| **Two Generals' Problem** | 비동기 네트워크 합의 불가능성 증명 — 엄밀히는 at-least-once 멱등성 문제와 구분 | L4 |
| **At-least-once + 멱등성** | 재시도 가능 환경에서 중복 실행 허용하고 결과 멱등하게 설계 | L4 |
| **Idempotency Key** | 같은 키 여러 번 호출해도 1번만 처리 | L4 |
| **Fencing Token** | 분산 락 안전성을 위한 단조 증가 토큰 (Redisson도 별도 설계 필요) | L4 |
| **Redisson Watchdog** | 보유자 생존 중 락 TTL 자동 연장 (만료 후 작업은 막지 못함) | L5 |
| **RedLock** | 멀티 노드 Redis 분산 락 알고리즘 (Kleppmann 비판 이후 논란) | L5 |
| **etcd / ZooKeeper (consensus-based)** | 강한 일관성 분산 코디네이터, 금융급 보장에 적합 | L5 |
| **2PC / XA Transaction** | 분산 트랜잭션, 외부 시스템 지원 필요 | L4 |
| **Saga / Compensating Transaction** | 분산 환경에서 롤백 불가 시 보상 트랜잭션 | L5 |
| **Reconciliation Batch** | 사후 무결성 검증 배치 (business-key 단위) | L5 |
| **Quarantine vs FAILED** | 사고 시 회수 가능한 요청은 quarantine, FAILED는 되돌릴 수 없음 | L5 |
| **Freeze → Scope → Mitigate → Reconcile** | 시니어 사고 대응 프레임워크 | L5 |
| **DLQ (Dead Letter Queue)** | 처리 실패 메시지 격리 저장소 | L5 |
| **Feature Flag + Kill Switch** | 긴급 차단 수단 | L5 |
| **Dry-run / Rollback Strategy** | 운영 작업 시 필수 안전장치 | L5 |

---

## 면접 전 최종 체크리스트

이 실험으로 방어할 수 있는 면접 질문 수준:

- [x] **JPA Dirty Checking의 내부 동작** (EntityEntry, snapshot 비교)
- [x] **InnoDB MVCC의 구현** (DB_TRX_ID, ReadView, undo log)
- [x] **격리 수준별 trade-off와 선택 근거**
- [x] **X-lock이 Lost Update를 못 막는 이유** (순서 vs 정합성)
- [x] **HikariCP 풀 크기 vs 정합성의 반직관적 관계**
- [x] **Optimistic vs Pessimistic vs 분산 락 선택 기준**
- [x] **Two Generals' Problem과 멱등성 설계**
- [x] **2PC/Saga 불채택 근거 + 실용적 대안**
- [x] **synchronized의 분산 환경 한계**
- [x] **Redisson Watchdog, Fencing Token의 필요성**
- [x] **관측성 설계** (Prometheus 메트릭, Grafana 파생지표)
- [x] **Reconciliation batch로 사후 무결성 검증**
- [x] **사고 대응 시나리오** (트리아지 → 차단 → 복구 → 포스트모템)
- [x] **운영 스크립트의 안전 설계** (dry-run, checkpoint, audit)

---

## 다음 실험으로 이어지는 질문

- **이슈 #5 (`synchronized`)**: 단일 인스턴스에서는 막히지만, 2개 인스턴스 띄우면 즉시 무력화되는 것을 **docker-compose로 실증**
- **이슈 #6 (`SELECT FOR UPDATE`)**: 비관적 락이 스크래퍼 25초 호출 시 DB 커넥션을 점유해 TPS가 얼마나 떨어지는지 측정
- **이슈 #7 (Redisson)**: 분산 락의 watchdog 동작 원리 확인, 운영 Redis SETNX 구조와 비교
- **추가 실험 후보**: `@Version` 적용 시 충돌률 vs 재시도 횟수 곡선, livelock 재현

## 실험 → 실무 연결

이 실험은 본인이 운영 중인 시스템의 **Redis SETNX 기반 `reply.id` 락**이 왜 존재해야 하는지를 재현 가능한 형태로 정리한 것.

면접에서의 핵심 문장:

> "운영 코드에 이미 분산 락이 있지만, 그 락이 왜 필요한지 제 손으로 실측 증명하고 싶었습니다. 락을 제거한 상태에서 100 스레드 동시 호출 시 외부 API 100번 중복 호출 + DB retry_count 88건 증발을 관찰했고, 이게 바로 그 락이 막고 있는 사고의 규모입니다. 그리고 이 과정에서 JPA Dirty Checking 내부, InnoDB MVCC 구현, 분산 락의 안전성 이론까지 엮어 이해할 수 있었습니다."
