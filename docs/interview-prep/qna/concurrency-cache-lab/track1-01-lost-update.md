# Lost Update — 배달앱 댓글 중복 등록 사고의 근본 원인

> **Repo**: concurrency-cache-lab
> **Issue**: [#4](https://github.com/PreAgile/concurrency-cache-lab/issues/4)
> **실험 문서**: [track1-01-no-lock.md](https://github.com/PreAgile/concurrency-cache-lab/blob/main/docs/experiments/track1-01-no-lock.md)
> **작성일**: 2026-04-15

---

## 도메인 맥락 — 왜 "댓글 처리"인가

배달앱(네이버, 쿠팡이츠, 배민, 요기요 등) 리뷰에 사장님이 답글을 달 수 있는 기능. 수백 수천 건의 리뷰에 일괄 답글을 예약 등록하면:

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
- API 서버(backend)는 스크래퍼에 **Long-running HTTP 요청**을 보냄
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

## Q0. 왜 '댓글 처리' 도메인으로 실험했나요?

### L1 — 개념

B2B SaaS 서비스에서 **외부 플랫폼 API 호출이 포함된 상태 머신**은 멱등성이 깨지면 즉시 비즈니스 사고가 됩니다. 같은 reply_request에 대한 processReply() 중복 호출은 외부 플랫폼에 중복 답글 등록으로 직결됩니다. 이 도메인이 "락의 존재 이유"를 가장 명확하게 보여준다고 판단했습니다.

### L2 — 왜 이 도메인이 실험에 최적인가

세 가지 조건을 모두 만족:

1. **read-modify-write 패턴이 명확**: `retry_count += 1`, `status 전이`
2. **비즈니스 임팩트가 즉각적**: 답글 중복 = 사장님 컴플레인
3. **분산 환경 경합이 자연스럽게 발생**: Long-running HTTP 호출 + 자동/수동 재시도 + 멀티 인스턴스 API 서버

### L3 — 트레이드오프: 다른 도메인 후보들

| 도메인 | Lost Update 명확성 | 비즈니스 임팩트 | 본인 운영 경험 연결 |
|--------|:-:|:-:|:-:|
| **댓글 처리 (선택)** | ★★★ | ★★★ | ★★★ |
| 매출 집계 | ★★★ | ★★★ | ★★ |
| 평균 평점 | ★★ | ★★ | ★★★ |
| API Rate Limit | ★★★ | ★★ | ★★★ |

댓글 처리가 **외부 스크래퍼 HTTP 호출 + 상태 머신 + 멀티 인스턴스 API 서버**를 모두 포함해서 현실성이 가장 높음.

### L4 — CS 심화: 이 패턴이 보여주는 것

단순 "숫자 Lost Update"가 아니라 **분산 시스템의 근본 문제**:
- DB는 롤백 가능 (ACID)
- **외부 시스템(플랫폼 API)은 롤백 불가** (Saga, Compensating Transaction 필요)
- 락이 없으면 "외부 호출이 이미 일어난 상태"를 되돌릴 수 없음

이게 바로 **멱등성(Idempotency)**이 분산 시스템에서 중요한 이유.

### L5 — 본인 경험 연결

> "운영 중인 B2B SaaS의 댓글 처리 API에 Redis SETNX 기반 `reply.id` 단위 락이 구현되어 있습니다. 같은 reply에 대한 처리 요청이 동시에 들어오면 첫 요청만 스크래퍼로 보내고 나머지는 '이미 처리 중' 응답으로 조기 반환합니다. 이 락이 없었을 때 외부 플랫폼에 답글 중복 등록 사고가 있었고, 그 사고를 단순화해서 재현 가능한 형태로 만든 게 이 실험입니다."

---

## Q1. Lost Update가 정확히 무엇이고, 왜 발생합니까?

### L1 — 개념

Lost Update는 두 개 이상의 트랜잭션이 같은 데이터를 read-modify-write 패턴으로 수정할 때, 한 트랜잭션의 수정이 다른 트랜잭션에 덮어써져 사라지는 현상입니다. 실험에서 100번의 processReply 호출 중 88번이 물리적으로 사라졌습니다.

### L2 — 원리

JPA의 `@Transactional` + 변경 감지(Dirty Checking) 흐름:

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

**핵심**: Dirty Checking은 "내가 읽은 시점 기준 객체가 변경되었는가?"만 봅니다. **DB 현재 상태를 재확인하지 않습니다.**

### L3 — 트레이드오프

왜 JPA가 이렇게 "느슨하게" 동작하는가? **성능 때문**:

| 전략 | Lost Update 방지 | 비용 |
|---|:---:|---|
| **Dirty Checking만 (현재)** | ✗ | **거의 없음** |
| `@Version` (낙관적 락) | ✓ (예외로) | 재시도 로직 필요 |
| `SELECT FOR UPDATE` (비관적 락) | ✓ (대기로) | 커넥션 점유 시간 증가 |
| `SERIALIZABLE` 격리 수준 | ✓ (락으로) | TPS 수 배 감소 |

대부분의 웹 서비스는 조회:수정 비율이 9:1 이상이라 매번 락을 걸면 **읽기 성능까지 망가집니다**.

### L4 — CS 심화: InnoDB 락의 실제 동작

"InnoDB에 Row Lock 있는데 왜 Lost Update가 되지?" — 흔한 오해.

| 작업 | 락 | 읽는 방법 |
|---|---|---|
| `SELECT` | **없음** | MVCC 스냅샷 (undo log 따라가며 이전 버전 읽음) |
| `SELECT ... LOCK IN SHARE MODE` | S-lock | 현재 데이터 + 공유 락 |
| `SELECT ... FOR UPDATE` | X-lock | 현재 데이터 + 배타 락 |
| `UPDATE` / `DELETE` | X-lock | 현재 데이터 + 배타 락 |

시나리오 재분석:

```
T1: SELECT  ← 락 없음, 스냅샷 retry_count=0 읽음
T2: SELECT  ← 락 없음, 스냅샷 retry_count=0 읽음
T1: UPDATE  ← X-lock 획득, "retry_count=1로 써라"
T2: UPDATE  ← T1의 X-lock 대기 → T1 commit 후 획득 → "retry_count=1로 써라"
```

- X-lock은 **순서를 직렬화**하지만 **내용의 정합성은 보장하지 않습니다**
- T2의 UPDATE가 이긴 순간 "내가 아는 값(메모리의 1)"을 DB에 썼을 뿐
- "T1이 이미 1로 바꿨는지" 알 방법이 없음 — 그래서 덮어씀

**격리 수준별 Lost Update 방지 여부**:

| 격리 수준 | 방지? | 이유 |
|---|:---:|---|
| READ UNCOMMITTED | ✗ | 락 거의 없음, dirty read까지 허용 |
| READ COMMITTED | ✗ | 커밋된 것만 보지만 재검증 없음 |
| **REPEATABLE READ (MySQL 기본)** | **✗** | **MVCC 스냅샷으로 같은 값을 일관되게 읽을 뿐** |
| SERIALIZABLE | ✓ | SELECT가 자동으로 S-lock 획득 |

### L5 — 실무 사례

쿠팡이 공유한 장애 사례: "주문 수량 동기화 로직에서 락 없이 `count = count + N`을 했다가, 수만 건 누락 발생". 본질은 이번 실험과 같은 패턴.

토스 결제에서 Lost Update를 막는 방식:
1. 핵심 경로는 모두 **비관적 락** (잔액 변경 등)
2. 보조 경로(포인트 적립)는 **`@Version` + 재시도**
3. **매 분기별 무결성 감사 배치**로 사후 감지

**교훈**: "에러 없음 ≠ 정상". Lost Update는 예외 없이 조용히 사라지므로 로그/APM만으로는 절대 못 찾습니다. **reconciliation batch**가 필수.

---

## Q2. 왜 외부 API 이중 호출이 더 큰 문제인가요?

### L1 — 개념

DB는 롤백 가능하지만, **외부 시스템에 이미 일어난 API 호출은 되돌릴 수 없습니다**. 실험에서 retry_count는 12만 증가했지만 **외부 플랫폼 API는 100번 호출됐습니다**.

### L2 — 원리

```java
@Transactional
public void processReply(Long id) {
    ReplyRequest req = repo.findById(id);
    req.markProcessing();
    
    // ↓ 실제 운영 코드의 이 라인이 문제
    platformApi.registerReply(req.getReplyContent());  // HTTP 호출
    
    // 트랜잭션 롤백되어도 platformApi에 이미 등록된 답글은 그대로
}
```

@Transactional의 ACID 보장은 **DB 범위에서만 유효**. 분산 트랜잭션(XA)이 없는 한 외부 HTTP 호출은 별개 세계.

### L3 — 트레이드오프: 해결 전략

| 전략 | 원리 | 트레이드오프 |
|------|------|------------|
| **락** (Pessimistic/분산 락) | 동시 호출 자체를 막음 | TPS 하락, 락 관리 복잡 |
| **멱등성 키** (Idempotency Key) | 같은 키로 여러 번 호출해도 1번만 처리 | 외부 API가 지원해야 함 |
| **Outbox Pattern** | DB 커밋 후에만 외부 호출 이벤트 발행 | 지연 발생, 인프라 복잡도 |
| **Saga + 보상 트랜잭션** | 외부 호출 실패 시 취소 API 호출 | 취소 API 필요, 복잡 |

실무에서는 이들을 **조합**:
1. 락으로 동시 호출 방지 (1차 방어)
2. 멱등성 키로 중복 실행 방지 (2차 방어)
3. Outbox로 "DB 커밋 후 발행" 보장 (3차 방어)

### L4 — CS 심화: Two Generals' Problem

외부 호출의 근본 문제는 **"네트워크는 신뢰할 수 없다"**:
- HTTP 호출 후 응답이 안 오면: 성공? 실패? 모름
- 재시도하면: 중복 호출 위험
- 재시도 안 하면: 유실 위험

이 딜레마를 푸는 유일한 방법이 **멱등성(Idempotency)**. 외부 API가 멱등하게 설계되어 있으면 재시도가 안전. PG사, 카카오 API 등 대부분의 주요 플랫폼이 멱등성 키를 받는 이유.

### L5 — 본인 경험

> "운영 중인 댓글 등록 API는 **Redis SETNX + reply.id 단위 락**으로 1차 방어를 하고, 스크래퍼 호출 후 응답에서 실패 코드가 반환되면 **이미 등록된 답글인지 플랫폼 조회 API로 재확인** 후 재시도합니다. 순수 락만으로는 부족해서 '락 + 외부 상태 검증' 이중 방어를 구축했습니다.
>
> 플랫폼별로 멱등성 키 지원 여부가 달라서, 지원 안 하는 플랫폼은 이 이중 방어가 필수입니다."

---

## Q3. InnoDB Row Lock이 있는데 왜 Lost Update를 못 막나요?

### L1 — 개념

Row Lock은 UPDATE/DELETE 시점에만 걸리고, SELECT는 락 없이 MVCC로 읽기 때문입니다.

### L2 — 원리

Q1의 L4 참고. X-lock은 "동시 쓰기의 순서"는 보장하지만 "읽은 값이 아직 유효한지"는 보장하지 않습니다.

### L3 — 트레이드오프: 왜 SELECT에 자동 락을 걸지 않나?

SELECT에 자동 락을 걸면 SERIALIZABLE이 되는데, 이건 **읽기 성능을 수십 배 희생**합니다.

```
예: 리뷰 조회 TPS 10,000
- REPEATABLE READ: 10,000 유지
- SERIALIZABLE: 500~1000 (락 경합)
```

읽기가 쓰기보다 훨씬 많은 OLTP에서는 받아들일 수 없음.

### L4 — CS 심화: MVCC의 구현

InnoDB는 **undo log**와 **read view**로 MVCC 구현:

1. 각 행에 `DB_TRX_ID`(이 버전을 만든 트랜잭션 ID), `DB_ROLL_PTR`(이전 버전 undo log 주소) 숨은 컬럼
2. 트랜잭션 시작 시 `read view` 생성 — "이 시점에 어떤 트랜잭션들이 active인가?"
3. SELECT 시 각 행의 `DB_TRX_ID`를 read view와 비교:
   - 내 view보다 이후 트랜잭션의 변경 → undo log 따라가 이전 버전 읽음
   - 이 과정에 **락 없음**

덕분에 "읽기는 쓰기를 블록하지 않고, 쓰기는 읽기를 블록하지 않음" (non-blocking read).

### L5 — 운영 이슈

긴 트랜잭션이 열려있으면 undo log가 쌓입니다. `SHOW ENGINE INNODB STATUS`에서 `History list length`가 높아지는 것으로 감지 가능. 실제로 배치에서 트랜잭션을 장시간 유지하면 undo log가 GB 단위로 쌓여 디스크 고갈되는 사고도 있음.

**교훈**: 트랜잭션은 짧게, undo log 쌓임을 모니터링.

---

## Q4. 왜 정확히 12~13이 나왔나요? 5가 나와야 하지 않나요? (100/20)

### L1 — 개념

HikariCP max=20이니 "5라운드면 증가분 5"라고 단순 계산하면 맞지 않습니다. 실제로는 커넥션 획득 타이밍과 X-lock 경쟁이 섞여 10~13으로 수렴.

### L2 — 배치 모델

```
[1라운드] 20 스레드 SELECT (DB=0) → 20 UPDATE 대기 → 1 성공, 19 Lost
[2라운드] 다음 20 SELECT (DB=1) → 또 19 Lost, 1 성공
...
```

이론상 5라운드 = 증가분 5. 하지만 실제로는:
1. **커넥션 획득이 micro-second 단위로 분산** → 정확한 20개씩이 아님
2. **빠른 스레드는 커넥션을 반납 → 여러 번 라운드 참여**
3. **일부 스레드는 늦게 SELECT해서 이미 갱신된 값 읽음** → 증가분 더 생김

결과적으로 "평균 동시 UPDATE 대기 큐 길이 ~8"에서 100/8 ≈ 12~13의 패턴.

### L3 — 반직관적 사실: 커넥션 풀의 역설

| HikariCP max | 최종 retry_count |
|---|:---:|
| 1 | 100 (완벽 직렬화) |
| 20 (현재) | 12~13 |
| 100 | 1~2 |

**커넥션 풀을 키우면 정합성이 더 나빠집니다.** "풀은 성능 튜닝 수단이지, 정합성 수단이 아니다."

### L4 — CS 심화: InnoDB의 락 획득 알고리즘

InnoDB는 **FIFO 큐**로 X-lock 관리:

```
UPDATE 요청 → wait queue
  [T1] → [T2] → [T3] → ... → [T20]

T1 commit → T2 획득 → commit → T3 획득 ...
```

큐에 오래 대기할수록 다음 트랜잭션이 "이미 갱신된 값"을 읽을 가능성이 커집니다. 하지만 SELECT는 트랜잭션 **시작 시점**에 찍혀있어서 옛 스냅샷을 기반으로 UPDATE 전송. 그래서 "대기 큐 길이가 길수록 Lost 비율이 높아진다"는 관찰이 성립.

### L5 — 실무 교훈

과거 한 팀 사례: "트래픽 폭증에 대비해 HikariCP max를 50에서 200으로 올렸더니, **TPS는 올라갔는데 데이터 정합성 문제가 터짐**". 원인은 read-modify-write API의 Lost 비율 폭증.

**해결**: 커넥션 풀은 그대로 두고, 해당 API에만 `@Version` 추가 + 재시도. **"스케일은 DB 위에서, 정합성은 애플리케이션 레벨에서."**

---

## Q5. `@Version`은 언제 쓰고, 비관적 락은 언제 쓰나요?

### L1 — 개념

두 축으로 결정: **충돌 빈도**와 **재시도 비용**.

### L2 — 원리

**@Version (낙관적 락)**:
```sql
UPDATE reply_requests SET ..., version = 2
WHERE id = 1 AND version = 1
-- 0 rows affected → OptimisticLockingFailureException
```

**비관적 락**:
```sql
SELECT * FROM reply_requests WHERE id = 1 FOR UPDATE
-- 다른 트랜잭션 대기
```

### L3 — 트레이드오프

| | 낙관적 (`@Version`) | 비관적 (`FOR UPDATE`) |
|---|---|---|
| **락 획득** | 없음 (쓸 때만 검증) | SELECT 시점 즉시 |
| **실패 시** | 예외 → 재시도 | 대기 (타임아웃까지) |
| **커넥션 점유** | 짧음 | 김 (비즈니스 로직 동안 유지) |
| **적합한 충돌 빈도** | 낮음 | 높음 |
| **적합한 처리 시간** | 짧음 | 짧음 (길면 커넥션 고갈) |

**선택 기준**:
- 리뷰 메타데이터 수정 (드묾) → 낙관적
- **댓글 처리 API (빈번, 재시도 중첩)** → 비관적 or 분산 락
- 정산 집계 → 비관적 (정합성 절대)
- 조회수 +1 → 다른 전략 (Redis INCR)

### L4 — CS 심화: 낙관적 락의 재시도 폭발

낙관적 락의 맹점: **충돌이 많으면 오히려 비관적 락보다 느려집니다.**

```
충돌률 10% → 낙관적이 빠름
충돌률 50% → 비관적이 빠름
충돌률 90% → 낙관적은 livelock 가능
```

실무 대응:
- **최대 재시도 횟수** 제한 (3~5회)
- 지수 백오프(exponential backoff)
- 초과 시 비관적 락 fallback 또는 에러 응답

### L5 — 본인 경험

> "B2B SaaS 댓글 처리에서 처음엔 @Version으로 시도했는데, 대량 재처리 요청(수만 건)이 들어오면 충돌률이 30%+ 되면서 재시도 폭주로 TPS가 폭락했습니다.
>
> 이후 **Redis SETNX reply.id 락**으로 전환. 낙관적 락은 '충돌 감지'에 맞고, 고부하 상황에서는 '충돌 자체를 막는' 전략이 맞았습니다.
>
> 낙관적 락은 여전히 활용 중: 어드민의 reply_request 편집 화면에서 동시 수정 감지용. 사용자가 '다른 사람이 수정했습니다. 새로고침' 메시지를 보게 되는 것은 UX적으로 허용 가능."

---

## Q6. 멀티 인스턴스로 확장하면 어떤 새로운 문제가 생기나요?

### L1 — 개념

JVM 내 락(`synchronized`, `ReentrantLock`)은 다른 인스턴스의 스레드를 모르므로 무력화됩니다.

### L2 — 원리

```
[인스턴스 1]              [인스턴스 2]
synchronized(lock) {       synchronized(lock) {   ← 서로 다른 락 객체
    processReply(1)            processReply(1)
}                          }

→ 둘 다 동시 진입 → Lost Update 재발 → 외부 API 중복 호출
```

DB 비관적 락은 여전히 동작 (락은 DB 레벨). 하지만 **DB가 병목**이 됨.

### L3 — 트레이드오프: 분산 락 종류

| 방식 | 성능 | 안정성 | 복잡도 |
|---|---|---|---|
| **DB 락** (`FOR UPDATE`) | 중 | 높음 | 낮음 |
| **Redis SETNX** (수동) | 높음 | 중 (TTL 관리 어려움) | 중 |
| **Redisson** | 높음 | 높음 (watchdog 자동 연장) | 낮음 |
| **ZooKeeper** | 낮음 | 매우 높음 | 높음 |
| **etcd** | 낮음 | 매우 높음 | 높음 |

### L4 — CS 심화: 분산 락의 안전성

Martin Kleppmann의 유명한 비판(Redlock 알고리즘): **"분산 락은 완벽히 안전할 수 없다"**.

```
클라이언트 락 획득 → GC pause 10초 → TTL 만료
→ 다른 클라이언트가 락 획득
→ 원래 클라이언트 GC 끝나고 작업 수행 → 이중 처리
```

해결:
1. **Fencing Token**: 락 획득 시 단조 증가 토큰 발급, UPDATE 시 토큰 검증
2. **Idempotency Key**: 작업 자체를 멱등하게 설계
3. **Redis 단일 노드 + 짧은 작업**: Redlock 복잡성 피하기

### L5 — 본인 구현

> "실제 운영 시스템은 이 구조입니다:
> 1. `reply_request.id`를 키로 Redis SETNX (TTL은 스크래퍼 타임아웃 + 여유분)
> 2. 락 획득한 API 스레드만 스크래퍼에 HTTP 요청 전송, 나머지는 "이미 처리 중" 응답으로 조기 반환
> 3. 스크래퍼 응답 후 **플랫폼 조회 API로 답글 실재 등록 여부 재확인** (멱등성 보강)
> 4. 실패한 reply는 별도 "실패 큐" 테이블로 이동해 수동 검토
>
> '락 + 조회 검증 + DLQ'의 3중 방어 구조. Redisson도 검토했지만 이미 Redis SETNX가 운영 중이라 마이그레이션 비용 대비 이득이 적다고 판단했습니다."

---

## 핵심 키워드 정리

| 용어 | 한 줄 정의 | 어느 레벨 |
|------|-----------|:---:|
| **Dirty Checking** | 스냅샷과 managed entity 비교로 변경 감지 | L2 |
| **1차 캐시 (Persistence Context)** | EntityManager 범위의 managed entity 저장소 | L2 |
| **MVCC** | undo log + read view로 락 없이 이전 버전 읽기 | L4 |
| **X-lock / S-lock** | 배타/공유 락 | L4 |
| **REPEATABLE READ** | MySQL 기본 격리, non-blocking read 제공하지만 Lost Update는 안 막음 | L4 |
| **Optimistic Lock** | `@Version`, 커밋 시 충돌 감지 | L3 |
| **Pessimistic Lock** | `SELECT FOR UPDATE`, 즉시 대기 | L3 |
| **HikariCP max-pool-size** | 동시 DB 커넥션 상한 (정합성 수단 아님) | L3 |
| **Idempotency Key** | 같은 키 여러 번 호출해도 1번만 처리 | L4 |
| **Fencing Token** | 분산 락 안전성을 위한 단조 증가 토큰 | L4 |
| **Redisson watchdog** | 락 TTL 자동 연장, 좀비 락 방지 | L5 |
| **Two Generals' Problem** | 네트워크는 신뢰 불가 → 멱등성 필수 | L4 |
| **Saga / Compensating Transaction** | 분산 환경에서 롤백 불가 시 보상 트랜잭션 | L5 |
| **Reconciliation Batch** | 사후 무결성 검증 배치 | L5 |
| **DLQ (Dead Letter Queue)** | 처리 실패 메시지 격리 큐 | L5 |

---

## 다음 실험으로 이어지는 질문

- **이슈 #5 (`synchronized`)**: JVM 내 락으로 단일 인스턴스에서 막지만, 30+ 인스턴스에서는 무력화됨을 실측
- **이슈 #6 (`SELECT FOR UPDATE`)**: 비관적 락의 TPS 저하와 커넥션 병목 측정
- **이슈 #7 (Redisson)**: 분산 락의 watchdog 동작, 운영의 Redis SETNX와 비교
- **추가 비교 실험**: `@Version`을 붙여 "Lost Update는 막지만 재시도 폭증" 측정

## 실험 → 실무 연결

이 실험은 본인이 운영 중인 시스템의 `Redis SETNX 기반 reply.id 락`이 **왜 존재해야 하는지**를 재현 가능한 형태로 정리한 것. 면접에서:

> "운영 코드에 이미 분산 락이 있는데, 그 락이 왜 필요한지 직접 실험으로 증명하고 싶었습니다. 락을 제거한 상태에서 100 스레드 동시 호출 시 외부 API 100번 중복 호출 + DB retry_count 88건 사라지는 것을 실측했고, 이게 바로 그 락이 막고 있는 사고의 규모입니다."
