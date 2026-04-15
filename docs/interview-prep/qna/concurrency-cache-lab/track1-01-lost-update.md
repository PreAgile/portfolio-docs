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

### [꼬리질문] "그럼 Dirty Checking은 정확히 어떻게 구현되어 있나요? Hibernate 내부에서."

**L4 — CS 심화 (시니어 방어선)**

> "Hibernate는 엔티티를 로드할 때 **Persistence Context**에 엔티티 객체와 함께 **로드 시점 상태 스냅샷(loaded state)**을 함께 보관합니다. 스냅샷은 보통 필드값을 담은 배열 형태로 관리됩니다.
>
> flush 시점에 Hibernate는 각 엔티티에 대해 **현재 필드값 vs 스냅샷**을 필드별로 비교해 dirty property를 계산하고, 변경된 필드가 있으면 UPDATE SQL을 생성합니다. 정확한 코드 경로는 `EntityPersister.findDirty()` → 각 프로퍼티의 `Type.isDirty()`로 이어지고, bytecode enhancement가 켜져 있으면 `@LazyToOne`/dirty tracking 같은 별도 경로로 최적화됩니다.
>
> 중요한 건 이 매커니즘이 **DB 현재 상태를 참조하지 않는다**는 점입니다. T1이 커밋해서 DB가 1이 되어도 T2의 Hibernate는 자기 스냅샷(0)만 보고 '0 → 1 변경'으로 판단, UPDATE를 전송합니다. DB 입장에서는 이미 1인데 '1로 써라'가 오는 거죠.
>
> `@DynamicUpdate`를 쓰면 변경된 필드만 UPDATE에 포함하고, `@Version`을 쓰면 WHERE 절에 version 조건이 추가돼서 '내가 읽은 버전에서 안 바뀌었다'를 DB에 검증합니다. 단, 이건 Hibernate가 SQL WHERE를 바꾸는 방식이지 dirty checking 자체를 바꾸는 건 아닙니다."

### [꼬리질문] "1차 캐시는 어떤 자료구조로 되어있나요?"

**L4 심화**

> "Hibernate의 `StatefulPersistenceContext`는 **엔티티 키 기준의 Map 여러 개**로 구성됩니다. 한쪽은 `엔티티 키 → 엔티티 객체`, 다른 쪽은 `엔티티 키 → EntityEntry(로드 시점 스냅샷과 상태)`를 추적합니다. 엔티티 키는 엔티티 타입과 식별자를 기준으로 만들어진 내부 키 구조입니다.
>
> 하나의 `@Transactional` 범위 내에서 같은 ID로 `findById`를 두 번 부르면 두 번째는 DB를 안 가고 1차 캐시에서 바로 반환됩니다. **DB 격리 수준의 REPEATABLE READ와는 다른 메커니즘**이고, 애플리케이션 관점에서 같은 트랜잭션 내 동일 객체를 반복 참조하는 효과를 냅니다. 실험에서는 각 스레드가 **독립된 트랜잭션 = 독립된 Persistence Context**라서 1차 캐시가 공유되지 않고, 각자 DB에서 따로 SELECT합니다."

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
