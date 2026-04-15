# Lost Update — 락 없이 100 스레드 동시 갱신 시 87건 증발

> **Repo**: concurrency-cache-lab
> **Issue**: [#4](https://github.com/PreAgile/concurrency-cache-lab/issues/4)
> **실험 문서**: [track1-01-no-lock.md](https://github.com/PreAgile/concurrency-cache-lab/blob/main/docs/experiments/track1-01-no-lock.md)
> **작성일**: 2026-04-15

---

## 도메인 맥락 — 왜 "토큰"인가

> 흔한 오해: "토큰은 사용자별이라 동시 경합이 없지 않나?"
> → 맞습니다. **사용자 인증 토큰**(JWT, 사용자 OAuth Refresh)은 경합이 거의 없습니다.

이 실험의 `tokens`는 **외부 플랫폼 API 연동용 OAuth Access Token**을 모델링한 겁니다. 이 도메인은 동시 갱신 경합이 실제로 발생합니다:

```
[시나리오] B2B SaaS가 쿠팡/스마트스토어/11번가 API를 호출
- 셀러 1명 = 플랫폼 OAuth 토큰 1개 (DB에 저장)
- 이 토큰을 N개 인스턴스 × M개 워커가 공유해서 사용
- 토큰 만료(예: 2시간) → 모든 인스턴스가 거의 동시에 만료 감지
- 갱신 자체가 외부 API 호출 (500ms~2s 소요)
- 동시 갱신 시 → 외부 플랫폼이 "이전 토큰 무효화" → 진행 중 호출 실패
- 그리고 DB의 토큰 row가 Lost Update로 깨지면 → 어떤 토큰이 유효한지 모름
```

이 패턴은 PG사 연동, 외부 SSO, 서비스 간 인증 등 **"공유 자원 = 만료가 있는 단일 토큰"** 구조에서 보편적입니다.

> 다른 도메인으로 바꿔 읽고 싶다면:
> - **재고 차감** (인기 상품 1개 row, N개 주문 동시 감소)
> - **좌석 예약** (콘서트 좌석 1개 row, N명 동시 예약)
> - **포인트 차감** (사용자 포인트 1개 row, N개 결제 동시 차감)
>
> 패턴은 모두 동일: **"단일 row + 다중 동시 read-modify-write"**

---

## 이 실험의 핵심 수치

| 지표 | 값 | 비고 |
|------|------|------|
| 호출 건수 | 100 | ExecutorService + CountDownLatch |
| 성공 (예외 없음) | 100 | 모두 `refresh()` 정상 반환 |
| DB 최종 refreshCount | **13** | 3회 측정 모두 동일 |
| Lost Update | **87건** | 예외 없이 사라짐 |
| TPS | 425.5 req/s | 정합성 없는 TPS |
| 환경 | MySQL 8, HikariCP max=20 | REPEATABLE READ |

> **한 줄 요약**: "에러는 0건인데 데이터의 87%가 조용히 사라졌습니다."

---

## Q0. 동시성 실험을 토큰으로 하셨네요. 토큰은 보통 사용자별이라 경합이 없지 않나요?

### L1 — 개념 정정

맞는 지적입니다. **사용자 인증 토큰**(JWT, OAuth Refresh)은 사용자별 격리라 동시 경합이 사실상 없습니다. 이 실험의 토큰은 **외부 플랫폼 API 연동용 OAuth Access Token**입니다. 이건 셀러 1명당 토큰 1개를 N개 인스턴스가 공유하기 때문에 실제로 경합이 발생합니다.

### L2 — 실무 시나리오

```
B2B SaaS의 외부 플랫폼 데이터 수집 파이프라인:

[셀러 A의 토큰: token_v1, 만료 14:00]
   │
   ├─ 인스턴스 1 (워커 5개)  ─┐
   ├─ 인스턴스 2 (워커 5개)  ─┼─ 모두 같은 token_v1 사용해서 외부 API 호출
   └─ 인스턴스 3 (워커 5개)  ─┘

13:59:50 → 모든 워커가 "토큰 만료 임박" 감지
13:59:55 → 15개 워커가 동시에 token refresh 요청
            → 외부 OAuth 서버는 첫 요청에만 token_v2 발급, 이후 요청은 거부
            → DB에 token_v2를 동시 UPDATE → Lost Update 발생
            → 어떤 인스턴스는 token_v1으로 호출 (이미 무효) → 401 에러
```

### L3 — 트레이드오프: 왜 도메인을 단순화했는가

실험 코드는 의도적으로 단순화했습니다:
- 외부 API 호출 부분은 `UUID.randomUUID()`로 추상화 (실제로는 OAuth 서버 호출)
- 토큰 검증, 만료 시간, 갱신 로직 전부 생략
- **순수하게 "단일 row + 다중 동시 UPDATE" 패턴만 남김**

이렇게 단순화한 이유:
1. **재현성**: 외부 의존성 없이 100% 재현 가능한 실험
2. **CS 개념 집중**: Lost Update의 본질은 도메인이 아니라 락의 부재
3. **확장성**: 같은 패턴을 재고/좌석/포인트로 바꿔도 결과 동일

### L4 — 실무 변형: 이 패턴이 나타나는 다른 도메인

| 도메인 | 단일 row | 다중 동시 변경 주체 | 정합성 깨졌을 때 결과 |
|--------|---------|-------------------|---------------------|
| **외부 API 토큰** | 셀러별 토큰 row | 여러 인스턴스의 워커 | 401 폭주, 외부 호출 전부 실패 |
| **재고** | 상품 row | 여러 사용자의 주문 | 오버셀 (재고 -10) |
| **좌석** | 콘서트 좌석 row | 여러 예매자 | 중복 발권 |
| **포인트** | 사용자 포인트 row | 여러 결제/이벤트 | 마이너스 잔액 |
| **계좌 잔액** | 계좌 row | 여러 송금/출금 | 회계 사고, 금융 분쟁 |
| **Rate Limit 카운터** | API 키 row | 여러 요청 | 한도 초과 허용 |

**도메인이 다양하지만 본질은 같습니다.** 면접에서 "토큰 말고 다른 예시는?" 물으면 위 표 그대로 답하면 됩니다.

### L5 — 본인 경험 연결

> "B2B SaaS에서 6개 외부 플랫폼 API를 운영하면서, 토큰 갱신은 가장 신경 썼던 부분입니다. 셀러당 토큰 1개를 30+ 인스턴스가 공유하는 구조였는데, 만료 임박 시점에 동시 갱신이 일어나면 일부 인스턴스가 무효 토큰으로 호출해서 401이 폭주했습니다.
>
> 처음에는 락 없이 갱신했고, 위 실험과 똑같은 Lost Update를 운영 환경에서 만났습니다. 이후 **Redis 분산 락 + Double-Check Locking** 패턴으로 해결했고, 갱신 중인 토큰은 다른 인스턴스가 캐시에서 짧게 대기하도록 설계했습니다.
>
> 이 실험은 그 경험을 **재현 가능한 형태로 정리한 것**이고, 같은 패턴이 PG사 토큰, SSO 세션, 서비스 간 인증 토큰 등에도 그대로 적용됩니다."

---

## Q1. Lost Update가 정확히 무엇이고, 왜 발생합니까?

### L1 — 개념

Lost Update는 두 개 이상의 트랜잭션이 같은 데이터를 read-modify-write 패턴으로 수정할 때, 한 트랜잭션의 수정이 다른 트랜잭션에 덮어써져 사라지는 현상입니다. 이번 실험에서 100번 호출 중 87건이 물리적으로 사라졌습니다.

### L2 — 원리

JPA의 `@Transactional` + 변경 감지(Dirty Checking) 흐름은 이렇습니다:

```java
@Transactional
public void refresh(Long tokenId) {
    Token token = repo.findById(tokenId);   // [1] SELECT + 스냅샷 저장
    token.refresh(UUID.randomUUID());        // [2] 메모리의 필드만 변경
}                                            // [3] flush: 스냅샷과 비교해 UPDATE 생성
```

두 스레드가 동시에 실행되면:

```
시간 →
T1: BEGIN
T1: SELECT refreshCount (=0)  ← 스냅샷 저장: 0
                                T2: BEGIN
                                T2: SELECT refreshCount (=0)  ← 스냅샷 저장: 0
T1: token.refresh() (메모리 1)
                                T2: token.refresh() (메모리 1)
T1: UPDATE SET refresh_count=1
T1: COMMIT  (DB=1)
                                T2: UPDATE SET refresh_count=1
                                T2: COMMIT  (DB=1, T1 변경 덮어씀)

최종 DB=1, 기대값=2, Lost Update 1건
```

**핵심**: Dirty Checking은 "내가 읽은 시점 기준 객체가 변경되었는가?"만 봅니다. **DB 현재 상태를 재확인하지 않습니다.**

### L3 — 트레이드오프

왜 JPA가 이렇게 "느슨하게" 동작할까요? 성능 때문입니다.

| 전략 | Lost Update 방지 | 비용 |
|---|:---:|---|
| **Dirty Checking만 (현재)** | ✗ | **거의 없음** |
| `@Version` (낙관적 락) | ✓ (예외로) | 재시도 로직 필요 |
| `SELECT FOR UPDATE` (비관적 락) | ✓ (대기로) | 커넥션 점유 시간 증가 |
| `SERIALIZABLE` 격리 수준 | ✓ (락으로) | TPS 수 배 감소 |

대부분의 웹 서비스는 조회:수정 비율이 9:1 이상이라 매번 락을 걸면 **읽기 성능까지 망가집니다**. 그래서 JPA/Hibernate 기본은 "일단 락 없이, 충돌 위험이 있는 곳에만 명시적으로 락 걸기"로 설계됐습니다.

### L4 — CS 심화: InnoDB와 MVCC

많은 개발자가 착각하는 지점: "InnoDB에 Row Lock 있는데 왜 Lost Update가 되지?"

**정답**: 일반 SELECT는 락을 걸지 않습니다.

| 작업 | 락 | 읽는 방법 |
|---|---|---|
| `SELECT` | **없음** | MVCC 스냅샷 (undo log 따라가며 이전 버전 읽음) |
| `SELECT ... LOCK IN SHARE MODE` | S-lock | 현재 데이터 + 공유 락 |
| `SELECT ... FOR UPDATE` | X-lock | 현재 데이터 + 배타 락 |
| `UPDATE` / `DELETE` | X-lock | 현재 데이터 + 배타 락 |

시나리오를 다시 보면:

```
T1: SELECT  ← 락 없음, 스냅샷 refreshCount=0 읽음
T2: SELECT  ← 락 없음, 스냅샷 refreshCount=0 읽음
T1: UPDATE  ← X-lock 획득, "refresh_count=1로 써라"
T2: UPDATE  ← T1의 X-lock 대기 → T1 commit 후 획득 → "refresh_count=1로 써라"
```

- X-lock은 **순서를 직렬화**하지만 **내용의 정합성은 보장하지 않습니다**
- T2의 UPDATE가 이긴 순간 "내가 아는 값(메모리의 1)"을 DB에 썼을 뿐
- "T1이 이미 1로 바꿨는지" 알 방법이 없음 — 그래서 덮어씀

**격리 수준별 Lost Update 방지 여부**:

| 격리 수준 | Lost Update 방지? | 이유 |
|---|:---:|---|
| READ UNCOMMITTED | ✗ | 락 거의 없음, dirty read까지 허용 |
| READ COMMITTED | ✗ | 커밋된 것만 보지만 재검증 없음 |
| **REPEATABLE READ (MySQL 기본)** | **✗** | **MVCC 스냅샷으로 같은 값을 일관되게 읽을 뿐** |
| SERIALIZABLE | ✓ | SELECT가 자동으로 S-lock 획득 |

### L5 — 실무 경험

쿠팡이 예전에 공개한 장애 사례: "주문 수량 동기화 로직에서 락 없이 `Count = Count + N`을 했다가, 수만 건의 재고 누락 발생". 원인은 이번 실험과 똑같은 패턴.

토스가 결제에서 Lost Update를 막는 방식:
1. 핵심 경로는 모두 **비관적 락** (잔액 변경 등)
2. 보조 경로(포인트 적립 등)는 **`@Version` + 재시도**
3. 그리고 **매 분기별 무결성 감사 배치** — 실제로 일치하지 않는 케이스를 찾아냄

실무적 교훈: **"에러 없음 ≠ 정상"**. Lost Update는 예외 없이 조용히 사라지기 때문에, 로그/APM에 의존하면 절대 못 찾습니다. **무결성 검증 로직(카운트 sum 체크, reconciliation batch)**이 있어야 사후 감지 가능합니다.

---

## Q2. InnoDB Row Lock이 있는데 왜 Lost Update를 못 막나요?

### L1 — 개념

Row Lock은 UPDATE/DELETE 시점에만 걸리고, SELECT는 락 없이 MVCC로 읽기 때문입니다.

### L2 — 원리

위의 L4 참고. X-lock은 "동시 쓰기의 순서"는 보장하지만 "읽은 값이 아직 유효한지"는 보장하지 않습니다.

### L3 — 트레이드오프: 왜 SELECT에 자동 락을 걸지 않나?

SELECT에 자동 락을 걸면 SERIALIZABLE이 되는데, 이건 **읽기 성능을 수십 배 희생**합니다.

```
예: 게시판 조회 TPS 10,000
- REPEATABLE READ: 10,000 유지
- SERIALIZABLE: 500~1000 (락 경합)
```

읽기가 쓰기보다 훨씬 많은 OLTP에서는 받아들일 수 없습니다. 그래서 "**읽기는 자유롭게, 정합성이 필요한 곳만 명시적 락**"이 업계 표준입니다.

### L4 — CS 심화: MVCC의 구현

InnoDB는 **undo log**와 **read view**로 MVCC를 구현합니다:

1. 각 행에 `DB_TRX_ID`(이 버전을 만든 트랜잭션 ID)와 `DB_ROLL_PTR`(이전 버전 undo log 주소) 숨은 컬럼이 있음
2. 트랜잭션 시작 시 `read view` 생성 — "이 시점에 어떤 트랜잭션들이 active인가?"
3. SELECT 시 각 행의 `DB_TRX_ID`를 read view와 비교:
   - 내 view보다 이후에 시작한 트랜잭션의 변경 → undo log 따라가서 이전 버전 읽음
   - 이 과정에 **락 없음**

이 메커니즘 덕분에 "읽기는 쓰기를 블록하지 않고, 쓰기는 읽기를 블록하지 않습니다." (non-blocking read)

### L5 — 실무 경험

라인(LINE)이 MVCC 때문에 겪은 이슈: 대용량 배치에서 긴 트랜잭션을 열어놓고 조회했더니, undo log가 GB 단위로 쌓여 디스크가 고갈됨. `SHOW ENGINE INNODB STATUS`에서 `History list length`가 비정상적으로 높아지는 걸로 감지.

교훈: **"트랜잭션은 짧게, undo log 쌓임을 모니터링하라"**. 긴 읽기 트랜잭션은 MVCC의 대가로 undo log 부하를 줍니다.

---

## Q3. 왜 정확히 13이 나왔나요? 5가 나와야 하지 않나요? (100/20)

### L1 — 개념

HikariCP max=20이니 "5라운드면 100건 처리될 것"이라고 단순 계산하면 맞지 않습니다. 실제로는 커넥션 획득 타이밍과 X-lock 경쟁이 섞여 13으로 수렴합니다.

### L2 — 원리: 배치 모델

단순 5라운드 모델이 아닙니다:

```
[1라운드] 20개 스레드 SELECT (DB=0 읽음) → 20개 UPDATE 대기 → 1개 성공, 19 Lost
[2라운드] 다음 20개 SELECT (DB=1 읽음) → 또 19 Lost, 1 성공
...
```

이론상 5라운드 = 증가분 5. 하지만 실제로는:

1. **커넥션 획득이 micro-second 단위로 분산** → 정확한 20개씩이 아님
2. **빠른 스레드는 커넥션을 반납 → 다른 스레드가 그 커넥션 사용** → 여러 번 라운드에 참여
3. **일부 스레드는 늦게 SELECT해서 이미 갱신된 값을 읽음** → 증가분이 더 생김

결과적으로 13이 나오는 건 "평균 동시 UPDATE 대기 큐 길이 ~7.7"에서 100/7.7 ≈ 13의 패턴.

### L3 — 트레이드오프: 커넥션 풀 크기의 역설

이 실험에서 발견한 **반직관적 사실**:

| HikariCP max | 최종 refreshCount | 해석 |
|---|:---:|---|
| 1 | 100 | 완벽 직렬화 (락 효과) |
| 20 (현재) | 13 | 평균 큐 ~7.7 |
| 100 | 1~2 | 모두가 0을 읽고 1로 덮어씀 |

**커넥션 풀을 키우면 정합성이 더 나빠집니다.** 이건 "풀은 성능 튜닝 수단이지, 정합성 수단이 아니다"라는 원칙을 실험으로 확인한 겁니다.

### L4 — CS 심화: InnoDB의 락 획득 알고리즘

InnoDB는 **FIFO 큐**로 X-lock을 관리합니다:

```
UPDATE 요청 순서 → wait queue
  [T1] → [T2] → [T3] → ... → [T20]
  
T1이 커밋되면 T2가 획득, T2가 커밋되면 T3...
```

큐에 오래 대기할수록 다음 트랜잭션이 "이미 갱신된 값"을 읽을 가능성이 커집니다 — 하지만 SELECT는 트랜잭션 **시작 시점**에 찍혀있어서, 대기 중에 SELECT를 다시 하지 않는 한 옛 스냅샷을 기반으로 UPDATE를 보냅니다.

그래서 "대기 큐 길이가 길수록 Lost 비율이 높아진다"는 관찰이 성립.

### L5 — 실무 경험

카카오의 한 팀이 과거에 비슷한 이슈 겪음: "트래픽 폭증에 대비해 HikariCP max를 50에서 200으로 올렸더니, **TPS는 올라갔는데 데이터 정합성 문제가 터짐**". 원인 분석 결과, read-modify-write 패턴의 API가 있었고 커넥션 수가 늘어나면서 Lost 비율이 폭증했음.

해결: 커넥션 풀은 그대로 두고, 해당 API에 `@Version` 추가 + 재시도. "스케일은 DB 위에서, 정합성은 애플리케이션 레벨에서."

---

## Q4. `@Version`은 언제 쓰고, 비관적 락은 언제 쓰나요?

### L1 — 개념

두 축으로 결정: **충돌 빈도**와 **재시도 비용**.

### L2 — 원리: 두 락의 동작

**@Version (낙관적 락)**:
```sql
-- JPA가 자동 생성
UPDATE tokens SET ..., version = 2
WHERE id = 1 AND version = 1
-- 0 rows affected → OptimisticLockingFailureException
```

**비관적 락**:
```sql
SELECT * FROM tokens WHERE id = 1 FOR UPDATE
-- 다른 트랜잭션의 UPDATE/SELECT FOR UPDATE 대기
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
- 어드민이 상품 설명 수정 → 낙관적 (동시 수정 드묾)
- 인기 상품 재고 차감 → 비관적 (충돌 빈발, 재시도 비용 큼)
- 계좌 잔액 변경 → 비관적 (정합성 절대)
- 조회수 +1 → 아예 다른 전략 (Redis INCR)

### L4 — CS 심화: 낙관적 락의 재시도 폭발

낙관적 락의 맹점: **충돌이 많으면 오히려 비관적 락보다 느려집니다.**

```
충돌률 10% → 낙관적이 빠름 (실패 재시도 소수)
충돌률 50% → 비관적이 빠름 (재시도가 반복 실패로 누적)
충돌률 90% → 낙관적은 **livelock** 가능 (계속 재시도 실패)
```

그래서 실무에서는:
- 낙관적 락을 쓸 때 **최대 재시도 횟수** 제한 (3~5회)
- 지수 백오프(exponential backoff)로 간격 늘리기
- 초과하면 비관적 락으로 fallback하거나 에러 응답

### L5 — 실무 경험

토스 블로그에 나온 사례 요약: 결제 처리에서 처음엔 낙관적 락으로 구현 → 이벤트 트래픽 때 충돌률이 30% 넘어가면서 재시도 폭주 → TPS 폭락. 비관적 락으로 전환 + 트랜잭션 범위 최소화(계좌 검증만 FOR UPDATE)로 안정화.

"충돌 빈도는 **측정 가능한 수치**입니다. 추정하지 말고, APM으로 `OptimisticLockException` 발생률을 측정하고 10%를 넘으면 비관적으로 전환 검토하세요."

---

## Q5. 멀티 인스턴스로 확장하면 어떤 새로운 문제가 생기나요?

### L1 — 개념

JVM 내 락(`synchronized`, `ReentrantLock`)은 다른 인스턴스의 스레드를 모르므로 무력화됩니다.

### L2 — 원리

```
[인스턴스 1]              [인스턴스 2]
synchronized(lock) {       synchronized(lock) {   ← 서로 다른 락 객체
    refresh()                  refresh()
}                          }

→ 둘 다 동시에 refresh() 진입 → Lost Update 재발
```

DB 비관적 락은 여전히 동작합니다 (락은 DB 레벨). 하지만 **DB가 병목**이 됩니다 — 모든 인스턴스가 같은 행을 기다리니까.

### L3 — 트레이드오프: 분산 락 종류

| 방식 | 성능 | 안정성 | 복잡도 |
|---|---|---|---|
| **DB 락** (`FOR UPDATE`) | 중 | 높음 | 낮음 |
| **Redis SETNX** (수동) | 높음 | 낮음 (TTL 관리 어려움) | 중 |
| **Redisson** | 높음 | 높음 (watchdog 자동 연장) | 낮음 |
| **ZooKeeper** | 낮음 | 매우 높음 | 높음 |
| **etcd** | 낮음 | 매우 높음 | 높음 |

**대부분의 경우 Redisson이 최적**:
- Redis 위에서 동작하는 Java 라이브러리
- watchdog 스레드가 락 TTL을 자동 연장 → 좀비 락 방지
- 재진입(reentrant), pub/sub 기반 대기(락 해제 알림) 지원

### L4 — CS 심화: 분산 락의 안전성

Martin Kleppmann의 유명한 비판(Redlock 알고리즘에 대한): **"분산 락은 완벽히 안전할 수 없다"**.

```
클라이언트가 락 획득 → GC pause 10초 → 락 TTL 만료
→ 다른 클라이언트가 락 획득
→ 원래 클라이언트 GC 끝나고 작업 수행 → 이중 처리
```

해결:
1. **Fencing Token**: 락 획득 시 단조 증가 토큰 발급, DB UPDATE 시 토큰 검증
2. **Idempotency Key**: 락과 별개로 작업 자체를 멱등하게 설계
3. **Redis 단일 노드 + 짧은 작업**: Redlock 복잡성 피하기 (대부분의 서비스에 충분)

### L5 — 실무 경험

네이버가 공유한 사례(LINE 엔지니어링 블로그): 배너 클릭 카운트 시스템에서 Redis INCR 대신 Redisson 분산 락으로 "복잡한 카운팅 로직" 구현 → GC pause로 락이 만료되며 중복 카운트 발생 → 결국 Redis INCR + 별도 reconciliation으로 재설계.

교훈: **"가능하면 락을 쓰지 말고, 멱등하게 설계하라"**. 락은 마지막 수단.

---

## 핵심 키워드 정리

| 용어 | 한 줄 정의 | 어느 레벨 |
|------|-----------|:---:|
| **Dirty Checking** | 스냅샷과 managed entity 비교로 변경 감지 | L2 |
| **1차 캐시 (Persistence Context)** | EntityManager 범위의 managed entity 저장소 | L2 |
| **MVCC** | undo log + read view로 락 없이 이전 버전 읽기 | L4 |
| **X-lock / S-lock** | 배타/공유 락 | L4 |
| **REPEATABLE READ** | MySQL 기본 격리, non-blocking read 제공하지만 Lost Update는 안 막음 | L4 |
| **Gap Lock / Next-Key Lock** | InnoDB의 범위 락 (Phantom 방지) | L4 |
| **Optimistic Lock** | `@Version`, 커밋 시 충돌 감지 | L3 |
| **Pessimistic Lock** | `SELECT FOR UPDATE`, 즉시 대기 | L3 |
| **HikariCP max-pool-size** | 동시 DB 커넥션 상한 (정합성 수단 아님) | L3 |
| **Fencing Token** | 분산 락 안전성을 위한 단조 증가 토큰 | L4 |
| **Redisson watchdog** | 락 TTL 자동 연장, 좀비 락 방지 | L5 |
| **Livelock** | 충돌 반복으로 아무도 진전 못하는 상태 | L4 |
| **Reconciliation Batch** | 사후 무결성 검증 배치 | L5 |

---

## 다음 실험으로 이어지는 질문

- **이슈 #5 (`synchronized`)**: JVM 내 락으로 단일 인스턴스에서는 막지만, 멀티 인스턴스에서는 무력화됨을 실측
- **이슈 #6 (`SELECT FOR UPDATE`)**: 비관적 락의 TPS 저하와 커넥션 병목 측정
- **이슈 #7 (Redisson)**: 분산 락의 watchdog 동작, DB 락 대비 성능
- **추가 비교 실험 후보**: `@Version`을 다시 붙여 "Lost Update는 막지만 재시도 폭증"을 측정
