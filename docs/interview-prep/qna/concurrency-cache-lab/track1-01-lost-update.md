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
> **둘째**, '외부 시스템이 이미 호출된 후 DB가 깨지는' 상황 재현 — 이게 **분산 시스템의 근본 문제**인데, 카운터로는 보여줄 수 없습니다. 댓글 등록은 외부 플랫폼 호출이 들어가서 'DB는 롤백 가능하지만 외부 호출은 롤백 불가능'이라는 본질을 자연스럽게 포함합니다.
>
> 그래서 Lost Update 재현과 **분산 시스템의 사고 패턴**을 동시에 보여주려면 이 도메인이 최적이었습니다."

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

### [꼬리질문] "그럼 Dirty Checking은 정확히 어떻게 구현되어 있나요? Hibernate 내부에서."

**L4 — CS 심화 (시니어 방어선)**

> "Hibernate는 **1차 캐시(Persistence Context)**에 엔티티를 로드하면서 동시에 `EntityEntry`를 생성합니다. `EntityEntry`는 '초기 상태 스냅샷(loaded state)'를 `Object[]` 배열로 보관합니다.
>
> flush 시점에 Hibernate는 `DefaultFlushEntityEventListener`가 **현재 엔티티 필드값 vs 스냅샷 값**을 `PropertyEquality.equals()`로 필드별 비교합니다. 하나라도 다르면 `Dirty!`로 마킹하고 UPDATE SQL을 생성합니다.
>
> 이 매커니즘이 DB 현재 상태를 참조하지 않기 때문에, T1이 커밋해서 DB가 1이 되어도 T2의 Hibernate는 자기 스냅샷(0)만 보고 '0 → 1 변경'으로 판단, UPDATE를 전송합니다. DB 입장에서는 이미 1인데 '1로 써라'가 오는 거죠.
>
> 만약 `@DynamicUpdate`를 쓰면 변경된 필드만 UPDATE 쿼리에 포함하지만 동작의 본질은 같습니다. `@Version`을 쓰면 WHERE 절에 version 조건이 추가돼서 '내가 읽은 버전에서 안 바뀌었다'를 DB에 검증하게 합니다."

### [꼬리질문] "1차 캐시는 어떤 자료구조로 되어있나요?"

**L4 심화**

> "`StatefulPersistenceContext` 내부의 `EntitiesByKey` — `Map<EntityKey, Object>` 구조입니다. `EntityKey`는 (엔티티 타입, 식별자, 영속성 유닛)의 튜플. `EntityEntriesByKey`가 별도로 `Map<EntityKey, EntityEntry>`로 스냅샷과 상태를 관리합니다.
>
> 하나의 `@Transactional` 범위 내에서 같은 ID를 `findById`하면 두 번째는 DB 안 가고 Map에서 바로 반환 — 이게 'Repeatable Read를 애플리케이션 레벨에서 흉내내는' 효과입니다. 실험의 경우 **트랜잭션마다 별도 Persistence Context**라서 스레드 간에는 공유되지 않습니다."

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

> 정확히 말하면, **일반 SELECT에 락이 없어서** Lost Update가 발생합니다. `SELECT ... FOR UPDATE`를 썼다면 T2가 SELECT 단계부터 대기했을 거고, T1 커밋 후 다시 읽어서 1을 보고 2로 업데이트했을 겁니다."

### [꼬리질문] "그럼 SERIALIZABLE로 올리면 해결되죠? 왜 기본값을 그걸로 안 하나요?"

**L3 — 트레이드오프 심화**

> "SERIALIZABLE은 **모든 SELECT를 `LOCK IN SHARE MODE`로 자동 변환**합니다. Lost Update 막히지만 대가가 큽니다.
>
> | 격리 수준 | 읽기 TPS (예시) | 쓰기 Deadlock 빈도 |
> |---|---|---|
> | READ COMMITTED | 10,000 | 낮음 |
> | REPEATABLE READ | 10,000 | 중 |
> | SERIALIZABLE | 500~1000 | **매우 높음** |
>
> 읽기가 9:1로 많은 OLTP에서 SERIALIZABLE은 **읽기 성능을 수십 배 희생**합니다. 거기다 락 그래프가 복잡해져서 Deadlock 탐지 + 재시도 비용도 큽니다.
>
> 그래서 업계 표준은 **'격리 수준은 REPEATABLE READ/READ COMMITTED 유지, 정합성이 필요한 곳만 명시적 락'** 입니다. 이 실험도 그 전제에서 출발합니다."

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
> 이 메커니즘이 **락 없는 읽기(non-blocking read)**를 가능케 하고, REPEATABLE READ는 ReadView를 '트랜잭션 시작 시점에 1번' 생성하는 반면 READ COMMITTED는 '매 SELECT마다' 생성합니다.
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
> 결과적으로 **'평균 동시 UPDATE 대기 큐 길이 ~8'** 에서 100/8 ≈ 12~13의 패턴으로 수렴합니다."

### [꼬리질문] "그럼 HikariCP max를 늘리면 어떻게 될까요?"

**L3 — 반직관적 트레이드오프**

> "이게 이 실험에서 가장 흥미로운 관찰인데, **커넥션 풀을 키우면 정합성이 더 나빠집니다.**
>
> | HikariCP max | 최종 retry_count | 해석 |
> |---|:---:|---|
> | 1 | 100 | 완벽 직렬화 — 락 없어도 순차 실행 |
> | 20 (현재) | 12~13 | 평균 큐 ~8 |
> | 100 | 1~2 | 모두가 0을 읽고 1로 덮어씀 |
> | 1000 | 1 | 사실상 모두 덮어쓰기 |
>
> 이게 중요한 이유는 실무에서 **'TPS 안 나와서 HikariCP max를 늘리자'** 라는 흔한 튜닝이 있는데, **정합성 문제가 있는 코드에서는 오히려 상황을 악화시킨다**는 겁니다.
>
> 원칙: **'커넥션 풀은 성능 튜닝 수단이지, 정합성 수단이 아니다'**. 정합성은 락으로 풀고, 스케일은 DB + 커넥션 풀로 풉니다. 두 축이 독립적이어야 합니다."

### [꼬리질문] "InnoDB X-lock의 대기 큐는 어떤 알고리즘인가요? FIFO인가요?"

**L4 — CS 심화**

> "기본은 **FIFO**지만 정확히는 **FIFO with lock compatibility**입니다. InnoDB 5.7부터는 `innodb_lock_wait_timeout` + `lock wait granted first` 정책으로 동작합니다.
>
> 하나의 행에 대해 wait queue가 있고, 트랜잭션이 락을 해제하면 큐의 맨 앞 트랜잭션에 락을 부여합니다. 만약 앞에 S-lock 대기가 여러 개 연속되어 있으면 호환 가능한 S-lock들을 한 번에 부여해서 wake up 시킵니다.
>
> 하지만 여기서 **Starvation 가능성**이 있습니다. 읽기(S-lock) 트래픽이 많고 쓰기(X-lock)가 소수일 때, 쓰기 트랜잭션이 계속 큐에서 밀릴 수 있습니다. MySQL 8.0부터는 `innodb_deadlock_detect`와 별도로 **fair scheduling**이 개선됐지만, 완전히 해결되진 않았습니다.
>
> 실험 수치가 12~13으로 일관되게 나오는 건 **큐 길이 분포가 거의 동일한 확률로 형성**되기 때문이고, 플랫폼(M2 Pro)의 스레드 스케줄링, HikariCP 내부 큐, InnoDB 락 큐 세 겹이 모두 결정적으로 동작하기 때문입니다. Linux 서버 + ARM64에서는 다른 숫자가 나올 수 있습니다."

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
    req.markProcessing();           // [A] DB 변경 — 트랜잭션 범위 내
    
    scraperClient.register(req);    // [B] 외부 HTTP 호출 — 트랜잭션 바깥
    
    req.markCompleted();            // [C] DB 변경
}
// @Transactional 롤백되어도 [B]는 이미 일어남
```

> "@Transactional의 ACID 보장은 **DB 범위에서만 유효**합니다. 분산 트랜잭션(XA)이 없는 한 외부 HTTP 호출은 별개 세계입니다. 그래서 '트랜잭션이 있다'는 착각이 더 위험합니다."

### [꼬리질문] "이게 바로 Two Generals' Problem 맞죠?"

**L4 — 분산 시스템 이론**

> "맞습니다. 분산 시스템에서 **'네트워크 너머의 작업이 성공했는지 불확실하다'**는 근본 문제입니다.
>
> - HTTP 호출 후 응답이 안 오면: 성공? 실패? 네트워크 끊김? 모름
> - 재시도하면: 중복 호출 위험
> - 재시도 안 하면: 유실 위험
>
> 이 딜레마를 푸는 유일한 방법이 **멱등성(Idempotency)**. 그리고 멱등성을 보장하는 방법은 3가지:
>
> 1. **작업 자체가 멱등**: `SET x = 5` (여러 번 실행해도 결과 같음)
> 2. **멱등성 키**: 클라이언트가 고유 키를 보내고, 서버가 '이 키는 이미 처리됨' 체크
> 3. **외부 상태 조회**: 호출 전/후에 '이미 등록됐는지' 조회해서 판단
>
> 배달 플랫폼 API는 대부분 **1번이 아닙니다** (답글 등록은 여러 번 하면 여러 개 됨). 멱등성 키를 지원하는 플랫폼도 있고 아닌 것도 있어서, 저희 시스템은 **3번 + 락의 이중 방어**로 풀었습니다."

### [꼬리질문] "그럼 Saga 패턴이나 2PC는 안 쓰는 이유는요?"

**L4/L5 — 아키텍처 판단**

> "**2PC (Two-Phase Commit)**는 외부 플랫폼이 XA 프로토콜을 지원해야 쓸 수 있는데, 배달 플랫폼 API는 지원 안 합니다. 일반 REST API일 뿐이라 2PC는 애초에 선택지에서 빠집니다.
>
> **Saga**는 이론적으로 가능한데, 현실적 장벽:
>
> 1. **보상 트랜잭션이 복잡**: 답글 등록 실패 시 → 이미 등록된 답글 삭제 호출 필요. 그런데 플랫폼마다 '답글 삭제' API 스펙이 다르거나 아예 없는 경우도 있음.
> 2. **Saga 오케스트레이터 운영 비용**: 상태 머신을 별도 관리해야 하고, 중간 실패 시 재시도/롤백 추적이 복잡.
> 3. **최종 일관성 (Eventual Consistency)**: 사장님 입장에서 '답글 달았는데 몇 초 뒤 취소됨'이 UX상 더 나쁨.
>
> 실제로 택한 건 **"강한 락으로 중복 자체를 방지 + 외부 조회로 이중 검증"** 입니다. Saga가 필요한 수준은 아니고, 락이 있으면 99.9% 케이스는 막히고, 나머지 0.1%는 외부 조회로 잡고, 그래도 실패하면 DLQ로 보내 수동 처리. **이 복잡도가 운영 비용 대비 적절한 지점**이라고 판단했습니다."

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

| | 낙관적 (`@Version`) | 비관적 (`FOR UPDATE`) | 분산 락 (Redisson) |
|---|---|---|---|
| 락 획득 시점 | 없음 (쓸 때만 검증) | SELECT 시점 | 별도 Redis 호출 |
| 실패 처리 | 예외 → 재시도 | 대기 (타임아웃) | 대기 or 즉시 실패 |
| DB 커넥션 점유 | 짧음 | 김 (비즈니스 로직 동안) | 짧음 |
| 적합한 충돌 빈도 | **낮음 (5% 이하)** | 중간 (5~30%) | 높음 (30%+) |
| 처리 시간 | 짧을 때 유리 | 짧을 때 유리 | **긴 작업에 유리** |

### [꼬리질문] "이 실험의 도메인 — 스크래퍼가 p99 25초 걸리는 상황 — 에서는 어떤 선택이 맞을까요?"

**L4 — 실전 판단**

> "**단연 분산 락이 맞습니다.** 이유를 구체적으로 말씀드리면:
>
> **@Version은 탈락**:
> - 25초 짜리 외부 호출이 진행 중인데, 그 사이 다른 재시도가 들어오면 version 충돌
> - 예외 발생 → 재시도 → 또 충돌 → 재시도... livelock 가능
> - 충돌률이 이벤트 시간대에 30~50%까지 올라가는데, 낙관적 락 재시도가 이걸 못 견딤
>
> **비관적 락(`FOR UPDATE`)도 탈락**:
> - SELECT FOR UPDATE로 잡는 순간 해당 row에 X-lock 걸림
> - 스크래퍼 호출이 25초 걸리는 동안 **DB 커넥션과 row lock을 25초 보유**
> - HikariCP max=20인데 100개 요청이 쌓이면 커넥션 고갈 → 전체 API 응답 불가
> - **DB 커넥션이 네트워크 I/O 대기 시간에 묶여 있는 게 최악**
>
> **분산 락(Redisson / Redis SETNX)**:
> - 락은 Redis에 두고, DB 커넥션은 찰나의 UPDATE에만 점유
> - 스크래퍼 호출 25초 동안 DB 커넥션 풀은 자유
> - 락 TTL은 스크래퍼 타임아웃(30초) + 여유분(5초)로 35초 설정
> - 충돌한 요청은 즉시 '이미 처리 중' 응답으로 조기 반환
>
> 실제 운영에서도 이 구조입니다."

### [꼬리질문] "Redisson 대신 그냥 `SETNX + EXPIRE`로도 되잖아요. 왜 Redisson까지 쓰나요?"

**L4 — 분산 락의 안전성**

> "`SETNX + EXPIRE`의 취약점:
>
> 1. **원자성 문제**: `SETNX` 후 `EXPIRE` 사이에 프로세스 크래시 → 좀비 락. Redis 2.6.12+는 `SET key value NX EX seconds`로 한 번에 원자적이지만, 이건 기본 수준.
>
> 2. **Fencing 부재**: GC pause나 네트워크 지연으로 락 TTL이 만료된 줄 모르고 작업을 계속하면, 다른 프로세스가 이미 락을 잡고 있음 → 이중 처리
>
> 3. **Watchdog 부재**: 작업이 TTL보다 길어질 때 TTL을 연장하는 메커니즘이 수동
>
> Redisson은 이걸 다 해결합니다:
>
> - **Watchdog**: 기본 30초 TTL, 작업이 진행 중이면 10초마다 자동 연장
> - **Pub/Sub 기반 대기**: 락이 해제되면 즉시 알림, polling 없음
> - **재진입(reentrant)**: 같은 스레드가 여러 번 획득 가능
> - **RedLock 알고리즘**: Redis 클러스터 환경에서 여러 노드에 동시 획득
>
> 다만 **Martin Kleppmann의 비판**도 알아야 합니다. RedLock은 '시계 동기화와 GC pause'라는 두 가지 가정에 의존하는데, 실제로는 이게 깨질 수 있어서 **완벽히 안전한 분산 락은 불가능**하다는 입장입니다. 해결은 **Fencing Token** — 락 획득 시 단조 증가 토큰 발급, 작업 시 DB UPDATE에 토큰 조건 추가.
>
> 제 시스템은 여기까진 안 가고, **'락 + 외부 상태 조회 + DLQ'의 실용적 3중 방어**로 정리했습니다. Fencing Token까지 구현하려면 스크래퍼 서비스에도 토큰 검증 로직이 필요해서 복잡도 대비 이득이 적다고 판단했습니다."

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
> 그리고 **장애 시 degraded mode 대비**도 있습니다:
> - Redis 불가 시 락 획득 실패 → 애플리케이션이 예외 처리
> - 예외 처리 기본값: '락 없이 진행' 또는 '작업 거부'
> - 저희는 **'작업 거부 + DLQ로 보관'**을 택했습니다. 외부 API 중복 호출을 감수하느니, 처리 지연을 감수하는 게 낫다는 판단.
>
> 또한 Redis failover 중에 이미 획득된 락은 신뢰할 수 없으니까, 락 획득 시 **Fencing Token**을 받는 설계도 고민했는데 지금은 '짧은 failover + DLQ'로 충분해서 미도입 상태입니다.
>
> 더 강한 보장이 필요하면 **Multi-Datacenter 환경 + RedLock + Fencing Token** 조합이 교과서 답인데, 저희 규모에선 과투자라고 판단했습니다."

---

## Q7. 관측성 — 어떻게 발견하고 증명했나

### [면접관] "이 사고가 실제로 운영에서 어떻게 드러났나요? 에러 로그가 안 나온다면서요."

**L1 — 발견 경로**

> "맞습니다. **에러 로그에는 전혀 안 나타났습니다**. 발견한 경로는:
>
> 1. **CS(고객센터) 컴플레인**: 사장님들이 '같은 답글이 두 번 달렸어요' 리포트
> 2. **일일 reconciliation 배치**: DB의 reply_requests.request_status와 외부 플랫폼 조회 결과를 비교하는 배치가 불일치를 발견
> 3. **Prometheus 대시보드**: '스크래퍼 호출 수 / reply_requests UPDATE 수' 비율이 1이 아니라 5~10으로 치솟는 순간 포착
>
> 특히 3번이 핵심이었습니다. **'에러 없음 ≠ 정상'** 이라는 걸 체감한 후부터 **비즈니스 메트릭의 비율을 모니터링**하는 습관이 생겼습니다."

### [꼬리질문] "구체적으로 어떤 메트릭을 어떻게 Prometheus에 보내나요?"

**L4 — 관측성 설계**

> "Micrometer로 커스텀 메트릭 4가지를 보냅니다:
>
> ```java
> Counter.builder("reply.scraper.requests")
>     .tag("platform", platform)
>     .tag("result", result)  // SUCCESS / FAILURE / TIMEOUT
>     .register(meterRegistry);
>
> Counter.builder("reply.db.status_transition")
>     .tag("from", fromStatus)
>     .tag("to", toStatus)
>     .register(meterRegistry);
>
> Timer.builder("reply.scraper.duration")
>     .tag("platform", platform)
>     .register(meterRegistry);
>
> Gauge.builder("reply.lock.held_count", lockRegistry, LockRegistry::size)
>     .register(meterRegistry);
> ```
>
> 그리고 Grafana에서 **파생 지표**를 계산합니다:
>
> ```promql
> # 이상 징후: 스크래퍼 호출 / DB 상태 전이 비율
> rate(reply_scraper_requests_total[5m])
>   / rate(reply_db_status_transition_total{to="COMPLETED"}[5m])
>
> # 정상: 1에 가까움 (호출 1번 = 성공 1번)
> # 이상: 2 이상 (같은 reply를 여러 번 호출)
> ```
>
> 이 비율이 1.5를 넘으면 Slack 알람. 그리고 P99 스크래퍼 duration이 30초 넘으면 스크래퍼 장애 알람.
>
> 락 모니터링도 중요합니다:
> ```promql
> # 락 보유 시간 분포
> histogram_quantile(0.99, rate(reply_lock_duration_seconds_bucket[5m]))
>
> # 좀비 락 감지 (TTL 이상 유지되는 경우)
> reply_lock_held_count > expected_max
> ```"

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

**L5 — 사고 대응 시나리오**

> "**T+0 (알람)**: Slack 알람 수신 → 온콜 엔지니어가 1차 트리아지
>
> **T+1분**: 현재 진행 중인 요청 차단
> - 배포 시스템 통해 feature flag `reply.enable_scraper=false` 활성화
> - 큐에 쌓인 재시도 요청 전부 FAILED 상태로 마킹
>
> **T+3분**: 범위 파악
> - `SELECT * FROM reply_requests WHERE updated_at > NOW() - INTERVAL 10 MINUTE`
> - 영향받은 reply ID 리스트 확보
> - 각 reply에 대해 Redis 분산 락이 획득되어 있는지 확인 (락 없는 구간 식별)
>
> **T+10분**: 원인 추정
> - 락 서비스(Redis) 장애 로그 확인
> - API 서버 최근 배포 여부 확인 (락 코드가 잘못 배포됐을 가능성)
> - 스크래퍼 응답 시간 이상 여부 확인
>
> **T+20분**: 긴급 조치
> - 원인에 따라 롤백, 락 서비스 복구, 또는 feature flag로 해당 기능 일시 차단
>
> **T+1시간**: 사용자 대응 준비
> - 중복 등록된 답글 목록 생성
> - 플랫폼별 삭제 API로 중복분 제거 스크립트 실행 (dry-run 먼저)
> - 사장님에게 사과 공지 + 자동 복구 안내
>
> **T+1일**: 포스트모템
> - 타임라인 정리
> - Root Cause + Why 5회
> - 재발 방지책 (예: 락 서비스 헬스체크 강화, feature flag 자동화)
> - 감지 지연 개선 (예: 중복 등록 탐지 알람 5분 주기 → 1분)
>
> 핵심은 **'언 수습 → 재발방지 → 학습'** 이 순서입니다. 즉시 멈추고, 원인 찾고, 조치하고, 사용자 대응하고, 포스트모템. 급하다고 원인 추정 전에 코드 수정 배포하면 더 큰 사고로 번집니다."

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
| **EntityEntry / Persistence Context** | Hibernate 1차 캐시의 내부 구조 | L4 |
| **StatefulPersistenceContext** | Map<EntityKey, EntityEntry> 기반 1차 캐시 구현체 | L4 |
| **MVCC / ReadView** | undo log + 트랜잭션 ID로 락 없이 이전 버전 읽기 | L4 |
| **DB_TRX_ID / DB_ROLL_PTR** | InnoDB의 숨은 MVCC 컬럼 | L4 |
| **History list length** | undo log 누적량 지표, 긴 트랜잭션 감지 | L5 |
| **X-lock / S-lock** | 배타/공유 락 | L4 |
| **Lock Queue (FIFO with compatibility)** | InnoDB 락 대기 큐 알고리즘 | L4 |
| **Starvation** | 쓰기 트랜잭션이 읽기에 계속 밀리는 현상 | L4 |
| **REPEATABLE READ** | MySQL 기본 격리, non-blocking read 제공하지만 Lost Update는 안 막음 | L3 |
| **Optimistic Lock (@Version)** | 커밋 시 충돌 감지, 재시도 기반 | L3 |
| **Pessimistic Lock (FOR UPDATE)** | SELECT 시점 즉시 대기 | L3 |
| **HikariCP max-pool-size** | 동시 DB 커넥션 상한 (정합성 수단 아님) | L3 |
| **Two Generals' Problem** | 네트워크 신뢰 불가 → 멱등성 필수 이론적 근거 | L4 |
| **Idempotency Key** | 같은 키 여러 번 호출해도 1번만 처리 | L4 |
| **Fencing Token** | 분산 락 안전성을 위한 단조 증가 토큰 | L4 |
| **Redisson Watchdog** | 락 TTL 자동 연장, 좀비 락 방지 | L5 |
| **RedLock** | 멀티 노드 Redis 분산 락 알고리즘 | L5 |
| **2PC / XA Transaction** | 분산 트랜잭션, 외부 시스템 지원 필요 | L4 |
| **Saga / Compensating Transaction** | 분산 환경에서 롤백 불가 시 보상 트랜잭션 | L5 |
| **Reconciliation Batch** | 사후 무결성 검증 배치 | L5 |
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
