# ADR-001: 메시지 브로커 선택 — Kafka vs RabbitMQ

- **날짜**: 2026-04-03
- **상태**: 결정됨
- **결정자**: 본인

---

## ADR이란?

**Architecture Decision Record**.
기술 결정을 내릴 때 "무엇을 결정했는가"뿐 아니라
"왜 그 결정을 했는가", "어떤 대안을 검토했는가", "어떤 트레이드오프가 있는가"를
문서로 남기는 방식이다.

코드는 "어떻게 구현했는가"를 보여주지만, ADR은 "왜 이렇게 설계했는가"를 보여준다.
면접에서 "왜 Kafka를 선택했나요?"라는 질문이 나올 때, 이 문서가 답변의 근거가 된다.

---

## 배경 — 실제 시스템 설명

### 운영 중인 서비스

배달 플랫폼 리뷰 관리 SaaS를 운영하고 있다.
사장님들이 배민, 요기요, 쿠팡이츠, 네이버, 땡겨요, 먹깨비 — 6개 플랫폼의 리뷰를
한 곳에서 확인하고, AI가 생성한 답글을 자동/수동으로 등록하는 서비스다.

### 실제 데이터 흐름 (코드 기반)

두 가지 실행 경로가 존재한다.

**경로 A — on-demand (사용자 트리거)**
```
[사용자 액션 → cmong-be]
  batchjobService.populateShop()
       │ HTTP POST http://mq.internal:8000/populate
       ▼
[cmong-mq / FastApi.py]
  subprocess.run([..., 'producer.py', '--id', shop_id, ...])
       │ 동기 블로킹 — producer.py 완료될 때까지 HTTP 응답 대기
       ▼
[producer.py] → DB + 외부 플랫폼 API + AI 서버
```

**경로 B — 배치 큐 (메인 서비스 내부 RabbitMQ)**
```
[cmong-be QueueService.sendBatchPopulateMessage()]
       │ emit → RabbitMQ
       ▼
[RabbitMQ]  (queue.constants.ts)
  queues: populate.batch.queue | scrap.queue | cpeats.scrap.queue | ...
  x-max-length: 10000, x-overflow: reject-publish
  prefetchCount: POPULATE_BATCH=1, DEFAULT=2
       │
       ▼
[cmong-be QueueConsumerController @EventPattern]
  ├─ isProcessed(messageId) → Redis 기반 중복 체크
  ├─ MAX_RETRY_COUNT=3, RETRY_DELAY_MS=5000
  └─ shopsService.populate() → batchjobService.populateShop()
       │ HTTP POST http://mq.internal:8000/populate
       ▼
[cmong-mq / FastApi.py] → subprocess.run → producer.py
```

**경로 C — 정기 배치 (EC2 crontab 직접 실행)**
```
crontab → mqscript.sh -p baemin/yogiyo/cpeats/...
  → producer.py 직접 실행 (HTTP 없음, RabbitMQ 없음)
```

**producer.py 내부 병렬 처리 구조**
```python
# getPlatformIdGroupList() — 그룹핑 기준: 자격증명 쌍
key = (platform_id, platform_password)  # ← 실제 코드
# platform_account_id는 그룹 내 참고용으로 수집됨

# 그룹 단위 병렬, 그룹 내 순서 처리
ThreadPoolExecutor(max_workers=N)
  ├─ Group (platform_id_A, pw_A) → shop_1 → shop_2 (순서)  ← 스레드 1
  └─ Group (platform_id_B, pw_B) → shop_1 → shop_2 (순서)  ← 스레드 2
```

`queue.Queue`는 로그 출력 순서 보장용이며 메시지 브로커가 아니다.
저장소 내 `consumer.py`는 RabbitMQ 공식 튜토리얼 코드이며 실제 서비스 코드가 아니다.

### 실제 프로덕션 실행 구조 (crontab 기반)

EC2 1대(운영 서버)에서 플랫폼별로 crontab을 통해 독립 프로세스로 실행한다:

```bash
# crontab — 플랫폼별 독립 실행
*/N * * * *  ./mqscript.sh -p baemin   → producer.py --w 30 --cron
*/N * * * *  ./mqscript.sh -p yogiyo   → producer.py --w 10
*/N * * * *  ./mqscript.sh -p cpeats   → producer.py --w 15 --reviews --days 7
*/N * * * *  ./mqscript.sh -p naver    → producer.py --w 4  --reviews
*/N * * * *  ./mqscript.sh -p ddangyo  → producer.py --w 10
*/N * * * *  ./mqscript.sh -p mukkebi  → producer.py --w 10

# 추가 크론
*/20 * * * *  scripts/cpeats_crontab_example.sh   # CPEATS 세션 유지
별도 실행      mqscript_hyphen.sh -p cpeats -h     # Hyphen API 경로
```

중복 실행 방지: `ps -ef | grep "[m]qscript.sh -p $PLATFORM"` — 이미 실행 중이면 exit.
**이 로직이 수평 확장을 구조적으로 막는다.** EC2 2대면 같은 플랫폼 크론이 동시 실행 → 토큰 경합.

동시 실행 스레드 합계:
```
baemin  30 + yogiyo 10 + cpeats 15 + naver 4 + ddangyo 10 + mukkebi 10
= 79개 스레드 + 각 Python 프로세스 오버헤드
```

### DB 핵심 구조

```sql
shops             -- PK: platform_shop_id(str), platform_account_id, is_active(0~4), deleted_at, last_crawled_at
platform_accounts -- PK: platform_account_id, platform_id/password, request_status('failed' 시 전체 정지)
reviews           -- PK: review_id(UUID), rating, reply1/2/3(AI 추천), blind_status, is_replied
replies           -- PK: reply_id(UUID), request_status(int 0~10), error_detail, retry_count
ai_replies        -- PK: ai_reply_id(UUID), rating_recommend(1~5), content, use_count
brand_shops       -- 프랜차이즈 매장 그룹핑 (brand_id → shop_id)
shop_deactivation_log   -- 비활성화 이력
platform_account_error_count -- 에러 횟수 추적
```

replies.request_status 상태 전이:
```
0 DEFAULT → 1 PENDING → 2 COMPLETED
                       → 3 COMPLETED_BY_CEO
                       → 4 FAILED → (retry) → 8 FAILED_WITHOUT_RETRY
                       → 9 BATCH_PENDING → 10 AUTO_REPLY_COMPLETED
```

---

## 플랫폼별 처리 특성과 실제 TPS

각 플랫폼은 크롤링 방식이 근본적으로 다르다. 이 차이가 아키텍처 결정에 핵심적인 영향을 준다.

### 빠른 플랫폼 (REST API 기반)

| 플랫폼 | 방식 | 매장 1개 처리 시간 | Worker 수 | 시간당 처리량 |
|-------|------|-----------------|---------|------------|
| baemin | 자체 API | ~2.5초 | 30 | ~43,200 매장 |
| yogiyo | 자체 API | ~3초 | 10 | ~12,000 매장 |
| ddangyo | 자체 API | ~3초 | 10 | ~12,000 매장 |
| mukkebi | 자체 API | ~3초 | 10 | ~12,000 매장 |

### 느린 플랫폼 (브라우저 기반)

| 플랫폼 | 방식 | 매장 1개 처리 시간 | Worker 수 | 시간당 처리량 |
|-------|------|-----------------|---------|------------|
| naver | 브라우저 (세션 엄격) | ~5초 | 4 | ~2,880 매장 |
| **cpeats** | **camoufox 브라우저** | **3~5분 (평균 4분)** | **15** | **~225 매장** |

**CPEATS 상세:**
```
camoufox = 실제 브라우저 프로세스로 세션 로그인 후 크롤링
브라우저 1개 ≈ 200~500MB RAM
EC2 8GB 기준 실질 동시 브라우저 수 15~20개가 물리적 상한

처리량:
  worker 1개: 1 shop / 240초 = 0.004 shops/초
  15 workers: 0.004 × 15 = 0.063 shops/초 = 225 shops/시간

CPEATS 매장이 10,000개라면: 10,000 / 225 ≈ 44시간 → 배치 1사이클 내 불가
```

그래서 `mqscript_hyphen.sh -h`(Hyphen REST API)를 별도로 운영한다.
Hyphen API는 REST 기반으로 camoufox 없이 빠르게 처리 가능.
CPEATS 매장이 Hyphen에서 실패하면 QUARANTINE 처리 후 12시간 후 재시도한다.
(QUARANTINE 상태 — 연속 실패 횟수 추적 → 격리 → probe 재시도 구조)

---

## 실제 발생한 문제들

### 문제 1: 재처리 불가 — API 스펙 변경 시 데이터 누락

HTTP → subprocess 모델에서 "특정 시점부터 다시 수집해야 한다"는 요구사항을 구조적으로 처리할 방법이 없다.

```
1. 플랫폼 API 스펙 변경 → 파싱 실패
2. 실패 시점의 HTTP 요청은 이미 사라짐
3. "어제 실패한 매장들 다시 수집해" → 수동 재요청 생성 필요
```

커밋 기록에서 반복 등장하는 패턴:
```
fix: 토큰 없는 경우 처리 로직 수정 (#387)
fix: v2로 응답 양식 변경 (#386)
```

API 스펙이 바뀔 때마다 이전 파싱 실패 매장들을 수동으로 재요청해야 한다.

### 문제 2: 동시성 — 인터-프로세스 자격증명 경합

producer.py 단일 프로세스 내에서는 `(platform_id, platform_password)` 쌍을 그룹 키로 사용해
같은 자격증명 그룹의 shops를 순서대로 처리함으로써 스레드 간 경합을 방지한다.

그러나 동시에 들어온 두 HTTP 요청(또는 두 개의 cron 트리거)이 각각 별도의 producer.py 프로세스를
생성하면 OS 레벨에서 같은 (platform_id, platform_password) 쌍에 동시 접근하는 문제가 생긴다:

```
HTTP 요청 A → producer.py 프로세스 1 → (platform_id_X, pw_X) 토큰 갱신 중
HTTP 요청 B → producer.py 프로세스 2 → (platform_id_X, pw_X) 토큰 동시 접근
                                       → 덮어쓰기 → 인증 실패
```

```
fix: 토큰 값이 덮어씌워질 수 있어 로직 수정 (#388)
fix: 같은 프로세스에서의 race condition 회피 (#373)
```

### 문제 3: 중복 처리로 인한 DB 중복 저장

```
Fix duplicate error (#378)
```

HTTP 요청이 타임아웃 후 재시도되거나, 처리 중 subprocess가 중단 후 재실행되면
같은 shop에 대해 처리가 두 번 발생한다:
- replies 테이블에 중복 행 생성
- 자동 댓글이 플랫폼에 두 번 등록

### 문제 4: 재배포 시 CPEATS 진행 중 작업 손실

CPEATS 매장 1개 처리에 최대 5분. 재배포하면 4분간 진행한 camoufox 크롤링 작업 전체 손실.
재시도 메커니즘 없음 — 다음 cron 실행까지 해당 매장 데이터 누락.

### 문제 5: 수평 확장 불가 — 단일 EC2 의존

```bash
# mqscript.sh
EXISTING_COUNT=$(ps -ef | grep "[m]qscript.sh -p $PLATFORM" | grep -v "$$" | wc -l)
if [ "$EXISTING_COUNT" -gt 0 ]; then
  echo "이미 동일한 플랫폼으로 실행 중. 중복 실행 방지."
  exit 1
fi
```

EC2를 2대로 늘리면 같은 플랫폼 크론이 두 서버에서 동시 실행 → platform_account 토큰 경합.
이 로직이 의도치 않게 수평 확장을 막는다.

### 문제 6: 플랫폼별 에러 임계값과 격리 상태의 복잡성

```python
# constants.py
PLATFORM_LOGIN_ERROR_COUNTS = {
    'BAEMIN': 3, 'YOGIYO': 2, 'CPEATS': 3,
    'DDANGYO': 3, 'NAVER': 1, 'MUKKEBI': 3,
}
```

네이버 로그인 1회 실패 → 전체 그룹 비활성화(is_active=4).
CPEATS Hyphen 실패 → QUARANTINE → 12시간 대기 → probe 재시도.
이 상태 로직이 producer.py, hyphen_client.py 등에 분산되어 있어 상태 추적이 어렵다.

---

## 현재 구조의 한계 — TPS 관점

### 단일 EC2에서 전체 처리량

```
동시 실행 처리량 합산:
  baemin  12 shops/초
  yogiyo   3 shops/초
  cpeats   0.06 shops/초 (camoufox 물리 한계)
  naver    0.8 shops/초
  ddangyo  3 shops/초
  mukkebi  3 shops/초
  ─────────────────────
  합계    ≈ 22 shops/초 = 79,200 shops/시간
```

### 수십만/수백만 건 처리 가능한가?

**현재 구조로는 불가**. 이유 3가지:

1. **CPEATS camoufox는 물리 한계**: 브라우저 프로세스 수 = EC2 메모리에 의존. 서버 추가해도 토큰 경합 구조 때문에 단순 확장 불가.

2. **Python GIL**: ThreadPoolExecutor worker 30개여도 CPU 바운드 구간(파싱, AI)은 GIL로 직렬화. 진정한 병렬 처리 아님.

3. **DB 커넥션 폭발**: 6 프로세스 × 각자 Pony ORM pool. baemin worker 30개면 30개 이상의 커넥션. MySQL 기본 max_connections=151 초과 위험.

---

## 검토한 대안

### Option A: RabbitMQ (현재 일부 사용 중)

cmong-be는 이미 RabbitMQ를 사용한다 (scrap.queue, cpeats.scrap.queue, populate.batch.queue).
prefetchCount 기반 처리 속도 제어, MAX_RETRY_COUNT=3 재시도, Redis 기반 중복 체크가 구현되어 있다.

그러나 현재 설정의 한계:
- `x-max-length: 10000, x-overflow: reject-publish` → 큐 가득 차면 메시지 거부(드롭). 저장이 아님.
- 소비 후 ack 완료 = 메시지 영구 삭제 → "2일 전 파싱 실패 메시지를 다시 처리"가 불가능
- 토큰 경합 → 별도 분산락 구현 필요 (RabbitMQ 자체 지원 없음)

**RabbitMQ로 부족한 점**: 단기 재시도(retry)와 기본 at-least-once는 제공하지만,
Kafka 수준의 **오프셋 기반 장기 리플레이**(offset reset으로 특정 시점부터 재처리)는
기본 큐 모델로 제공하지 않는다.
(참고: RabbitMQ Streams 플러그인은 오프셋 기반 소비를 지원하나, 현재 시스템은 classic queue 사용)

장점: Exchange/Routing Key 기반 유연한 라우팅, 운영 복잡도 낮음, 이미 운영 중
단점: 장기 메시지 재생 불가, 파티션 기반 병렬성 없음, 큐 가득 차면 신규 메시지 드롭

### Option B: Apache Kafka (선택)

실제 문제들을 Kafka로 어떻게 해결하는가:

| 실제 문제 | Kafka 해결 방식 |
|---------|--------------|
| API 스펙 변경 후 재처리 불가 | 메시지 보존 7일 — 오프셋 리셋으로 원하는 시점부터 재처리 |
| 인터-프로세스 토큰 경합 | 파티션 키 = platform_account_id → 같은 계정은 항상 같은 Consumer |
| 중복 처리 | Idempotent Consumer + processed_events 테이블 |
| 재배포 시 작업 손실 | Manual Commit — 크래시 후 재시작 시 동일 오프셋부터 재처리 |
| 수평 확장 불가 | Consumer 인스턴스 추가로 자동 파티션 재분배 |
| 플랫폼 상태 관리 분산 | Consumer Group 분리 — CPEATS 처리를 독립 서비스로 격리 |

장점: 메시지 보존, 파티션 키로 순서 보장, Consumer Group 독립 소비, 수평 확장
단점: 운영 복잡도 높음, 단순 RPC에는 오버스펙

### Option C: Redis Streams

장점: Redis 하나로 캐시 + 메시지큐 통합, 운영 단순
단점: 대용량 처리에서 Kafka 대비 성능 한계, 메시지 보존 정책 유연성 부족

---

## AI와 함께 검토한 내용

**내가 AI에게 물어본 것**:
> "CPEATS camoufox처럼 요청 1건에 3~5분 걸리는 태스크와,
> baemin처럼 2~3초짜리 태스크를 같은 Kafka topic에 넣으면 어떤 문제가 생기나?
> 두 특성을 어떻게 분리해야 하나?"

**AI 답변 요약**:
> "처리 시간이 극단적으로 다른 태스크를 같은 topic-partition에 두면
> 느린 태스크(CPEATS)가 fast consumer의 max.poll.interval.ms를 초과해 rebalance를 유발함.
> 해결책: topic을 빠른/느린 두 트랙으로 분리하고, slow topic은 max.poll.records=1로 설정."

**내 판단**:
플랫폼 특성이 근본적으로 다르므로 Kafka topic 자체를 분리한다.
CPEATS camoufox의 처리량 한계(시간당 225 매장)는 소프트웨어로 해결 불가 — 물리 제약이다.
재설계에서는 이 한계를 명시하고, Hyphen API 커버리지를 모니터링 지표로 추가한다.

---

## 결정: Kafka 선택 + 처리 특성별 트랙 분리

### 선택 근거

1. **재처리 요구사항이 실재한다**: API 스펙 변경(#386)마다 실패 매장 재처리가 필요하다. Kafka 오프셋 리셋으로 구조적 해결.

2. **파티션 키로 경합 방지**: 토큰 덮어쓰기 버그(#388)의 근본 원인은 같은 자격증명 쌍 `(platform_id, platform_password)`을 여러 프로세스가 동시에 접근하는 것. Kafka에서는 `platform_account_id`를 파티션 키로 사용한다. 실운영에서 각 platform_account는 고유한 자격증명을 가지므로 platform_account_id는 자격증명 쌍의 프록시로 동작하며, 같은 계정의 이벤트는 항상 같은 Consumer 파티션에서 순서대로 처리 → 경합 구조적 제거.

3. **처리 특성이 다른 플랫폼을 격리**: CPEATS camoufox(3~5분)와 baemin REST API(2~3초)를 같은 Consumer로 처리하면 slow task가 전체 Consumer Lag을 오염시킨다. topic 분리로 격리.

4. **수평 확장 가능**: Consumer 인스턴스 추가 = 파티션 재분배 자동화. 현재 `ps -ef` 중복 방지 로직 제거 가능.

### 포트폴리오 구현 설계

```
Kafka Topic 분리:

crawl.fast   (6 partitions)   baemin, yogiyo, ddangyo, mukkebi
  - WebClient 비동기 HTTP
  - Consumer Group: fast-consumer
  - max.poll.records=100
  - 처리 SLA: 매장 1개 < 10초

crawl.slow   (2 partitions)   cpeats(camoufox), naver
  - 브라우저 풀(BrowserPool, semaphore로 동시 수 제한)
  - Consumer Group: slow-consumer
  - max.poll.records=1       ← 처리 중 rebalance 방지
  - 처리 SLA: 매장 1개 < 10분

crawl.cpeats.hyphen (2 partitions)
  - Hyphen REST API 경로 (camoufox 불필요)
  - QUARANTINE 상태 로직 Consumer에 이식
```

```
플랫폼-api  → Kafka 발행까지: P99 < 100ms (k6 실측 목표)
Consumer Lag: 최대 10,000건 이내 (Prometheus + Grafana)
처리량 지표: processed_shops_total{platform="baemin"} (실측값으로 ADR 업데이트 예정)
```

### 이 결정이 틀렸다고 판단할 기준

- CPEATS Hyphen API 커버리지가 90% 이상이 된다면 → slow topic 자체가 불필요해질 수 있음
- Kafka 운영 복잡도가 팀 규모 대비 실익보다 크다면 → Redis Streams + 별도 이벤트 저장소 조합 재검토
- 단일 플랫폼 처리 순서 보장이 불필요해진다면 → 파티션 키 전략 재검토

---

## 구현 결정 사항

| 설정 | 값 | 근거 |
|-----|---|-----|
| crawl.fast 파티션 수 | 6 | 플랫폼 4개, Consumer 최대 6개 기준 |
| crawl.slow 파티션 수 | 2 | CPEATS+NAVER, 물리적 처리량 한계 |
| Replication Factor | 1 (로컬), 3 (운영 가정) | 로컬 단일 브로커 |
| 파티션 키 | `platform_account_id` | 토큰 경합 방지 (같은 계정 = 같은 Consumer) |
| `enable.auto.commit` | `false` | 처리 완료 후 Manual Commit — 재배포 시 유실 방지 |
| `max.poll.records` (fast) | `100` | `처리 시간 × 100 < max.poll.interval.ms(5분)` |
| `max.poll.records` (slow) | `1` | camoufox 5분 처리 → rebalance 방지 |
| `max.poll.interval.ms` (slow) | `600,000ms` | camoufox 최대 소요 10분 기준 |
| Dead Letter Topic | 활성화 | 3회 실패 시 DLT 이동 (기존 FAILED_WITHOUT_RETRY 상태와 동일 의미) |

---

## 업계 사례 — 국내 빅테크 기술블로그 참조

이 ADR의 결정 사항과 직접 연관되는 국내 빅테크 실전 사례를 정리한다.
각 사례가 현재 시스템의 어떤 문제를 보강하거나 더 나은 방향을 제시하는지 기록한다.

---

### 1. 슬로우 컨슈머 — `pause()/resume()` 기반 동적 쓰로틀링

**출처**: 우아한형제들 — [카프카 컨슈머에 동적 쓰로틀링 적용하기](https://techblog.woowahan.com/20156/)

Consumer를 단순 수평 확장하면 DB 같은 외부 시스템이 오버로드되는 현상을 `KafkaConsumer.pause()` / `resume()` + `ConsumerInterceptor` 조합으로 해결.
CPU 혹은 외부 시스템 응답 지연을 감지하면 컨슈머를 동적으로 일시 정지시켜 처리 속도를 줄인다.

**이 ADR과의 연관성**:  
`crawl.slow` topic의 CPEATS camoufox 컨슈머는 `max.poll.records=1`로 rebalance를 방지하지만, 브라우저 수 제한(EC2 메모리 기반)을 초과하면 동적으로 pause()해야 한다. `BrowserPool` semaphore와 연동해 "브라우저 풀 포화 → pause, 여유 생김 → resume" 흐름을 명시적으로 구현하면 backpressure를 코드 레벨에서 다룰 수 있다.

---

### 2. 장시간 작업의 Kafka 대안 — RDB 기반 Task Queue

**출처**: 우아한형제들 — [장시간 비동기 작업, Kafka 대신 RDB 기반 Task Queue로 해결하기](https://techblog.woowahan.com/23625/)

30분 이상 소요되는 엑셀 생성 태스크에서 Kafka `max.poll.interval.ms` 초과로 rebalance가 반복 발생. DB 폴링 방식으로 전환하여 `PENDING → IN_PROGRESS → DONE / FAILED` 상태 추적 + ShedLock 기반 자동 복구로 해결.

**이 ADR과의 연관성**:  
CPEATS camoufox 처리(최대 5분)는 `max.poll.interval.ms=600,000ms`로 설정해 Kafka 내에서 처리하도록 설계했지만, 향후 처리 시간이 더 늘어나거나 작업 큐를 외부에서 직접 조회해야 하는 요구가 생기면 RDB Task Queue 전환이 유력한 대안이 된다.  
현재 설계의 "이 결정이 틀렸다고 판단할 기준" 항목에 "CPEATS 처리 시간이 10분을 초과하는 빈도가 높아지면 → RDB Task Queue 재검토"를 추가할 수 있다.

---

### 3. Outbox Pattern — DB 커밋과 이벤트 발행의 원자성

**출처**:
- 우아한형제들 — [우리 팀은 카프카를 어떻게 사용하고 있을까](https://techblog.woowahan.com/17386/) (MySQL source connector 기반 Outbox)
- 토스 — [레거시 결제 원장을 확장 가능한 시스템으로](https://toss.tech/article/payments-legacy-5) (Outbox + Debezium CDC)
- 리디 — [Transactional Outbox 패턴으로 메시지 발행 보장하기](https://ridicorp.com/story/transactional-outbox-pattern-ridi/) (Polling Publisher + 분산락)

공통 패턴: "DB 트랜잭션 성공 → `outbox` 테이블 INSERT → Relay가 폴링하여 Kafka 발행". DB 커밋과 Kafka 발행을 분리해 `두 개의 원자적 연산`이 아닌 `하나의 DB 트랜잭션`으로 처리.

**이 ADR과의 연관성**:  
현재 `cmong-be → HTTP POST → cmong-mq` 경로는 HTTP 요청이 실패하면 이벤트가 유실된다. 포트폴리오 구현(ADR-005 예정)에서 Outbox Pattern을 채택해 `platform_api → outbox 테이블 INSERT → Relay → Kafka` 흐름으로 설계하면, 이 문제를 구조적으로 제거할 수 있다.

---

### 4. 외부 API Rate Limiting — 플랫폼별 호출 제어

**출처**:
- 토스 — [해외주식 서비스 안정화](https://toss.tech/article/overseas-securities-server) (resilience4j TPS 제한 + 상태 머신)
- LINE — [고 처리량 분산 비율 제한기](https://engineering.linecorp.com/ko/blog/high-throughput-distributed-rate-limiter/) (인스턴스별 할당량 분할)

토스는 외부 브로커 응답 불안정 시 `HEALTHY / CAUTION / CRITICAL` 3단계 상태 전이를 Kafka 이벤트로 브로드캐스트해 각 컨슈머가 독립적으로 처리 속도를 조절.  
LINE은 초당 30만 건 처리를 위해 Redis 중앙 집중 대신 각 인스턴스에 할당량을 나눠 네트워크 병목 제거.

**이 ADR과의 연관성**:  
현재 `PLATFORM_LOGIN_ERROR_COUNTS = {'NAVER': 1, 'BAEMIN': 3, ...}`는 하드코딩된 임계값으로, 런타임 조정이 불가능하다.  
resilience4j `RateLimiter` + `CircuitBreaker`로 플랫폼별 API 호출을 제어하고, 상태 전이를 Kafka 이벤트로 전파하면 에러 임계값 로직이 Consumer 코드에서 분리된다.

---

### 5. 상태 머신 — 분산 상태 추적의 명시적 모델링

**출처**: 토스 — [해외주식 서비스 안정화](https://toss.tech/article/overseas-securities-server), 우아한형제들 — [RDB Task Queue](https://techblog.woowahan.com/23625/)

두 사례 모두 상태를 명시적 enum(또는 sealed class)으로 정의하고, 유효하지 않은 전이는 컴파일 타임 또는 런타임에서 차단. 상태별 SLA를 별도 메트릭으로 노출.

**이 ADR과의 연관성**:  
현재 `replies.request_status (0 DEFAULT → ... → 10 AUTO_REPLY_COMPLETED)` 전이 로직이 `producer.py`와 `hyphen_client.py` 등 여러 곳에 분산되어 있다. 포트폴리오에서는 Spring Statemachine 또는 sealed class 기반 명시적 상태 머신으로 전이 로직을 한 곳에 집중시키면, "어디서 전이가 일어났는가"를 추적 가능하게 된다.

---

### 6. Consumer Group 분리 — 도메인 독립성 확보

**출처**: 카카오 — [Genesis Kafka Connect 플랫폼](https://tech.kakao.com/2022/04/13/kafka-connect-streaming-data-platform/), 토스증권 — [수천 개 실시간 데이터 파이프라인 운영](https://toss.tech/article/toss-securities-visualize-lineage)

여러 Consumer Group이 동일 topic을 독립적으로 소비. 한 Consumer Group이 지연되거나 리셋되어도 다른 Group에 영향 없음. JMX + Prometheus로 Group별 lag을 개별 모니터링.

**이 ADR과의 연관성**:  
포트폴리오 구현에서 `crawl.fast` topic을 "리뷰 수집 Consumer Group"과 "답글 생성 Consumer Group"이 각각 독립 소비하도록 설계하면, AI 서버 지연이 수집 Consumer의 lag에 영향을 주지 않는다. 각 Group의 Consumer Lag을 `consumer_lag{group="review_collect"}` vs `consumer_lag{group="reply_generate"}` 형태로 분리해 모니터링한다.

---

### 아키텍처 개선 포인트 요약

| 현재 시스템 문제 | 업계 사례 | 포트폴리오 적용 방향 |
|---|---|---|
| CPEATS 브라우저 풀 포화 시 제어 불가 | 우아한형제들 `pause()/resume()` | BrowserPool semaphore ↔ KafkaConsumer pause 연동 |
| CPEATS 5분 작업이 더 길어지면 rebalance | 우아한형제들 RDB Task Queue | `max.poll.interval.ms` 초과 빈도 기준으로 전환 기준 명시 |
| HTTP 이벤트 유실 가능성 | 토스/우아한형제들/리디 Outbox | ADR-005에서 Outbox → Kafka Relay 설계 |
| 플랫폼별 에러 임계값 하드코딩 | 토스 resilience4j + 상태 전이 | CircuitBreaker 기반 동적 Rate Limiting |
| 상태 전이 로직 분산 | 토스/우아한형제들 명시적 상태 머신 | sealed class / Spring Statemachine으로 단일화 |
| Consumer Lag 통합 모니터링 불가 | 카카오/토스증권 Group별 Prometheus | Consumer Group별 lag 메트릭 분리 |

---

## 참고

- 내부 서비스 코드 구조는 비공개. 위 설명은 문제 패턴을 재구성한 것
- [Kafka 공식 문서 - Consumer Configuration](https://kafka.apache.org/documentation/#consumerconfigs)

---

Model: GPT-5 (Codex)

- 로컬 코드 조사 결과, `cmong-mq`의 핵심 실행 구조를 HTTP 요청 -> `subprocess.run()` -> `producer.py`로 설명한 큰 방향은 맞다.
- 다만 몇몇 핵심 문장은 현재 코드와 정확히 일치하지 않거나, RabbitMQ/Redis/Kafka의 특성을 너무 단정적으로 비교하고 있다.
- 특히 RabbitMQ를 "재처리 구조적으로 불가능"이라고 적은 부분은 공식 문서 기준으로 과장이다. Kafka가 더 적합하다는 결론은 유지할 수 있어도, 근거 문장은 수정하는 편이 좋다.
- 면접/포트폴리오 문서로서 신뢰도를 높이려면 "코드로 확인된 사실", "운영에서 관측한 수치", "설계 가정"을 분리해서 쓰는 것이 가장 큰 개선 포인트다.

- Severity: High
  Issue: Option A에서 RabbitMQ를 "소비된 메시지 영구 삭제", "특정 시점부터 다시 처리 구조적으로 불가능"으로 단정한 서술이 부정확하다.
  Impact: 이 문장은 기술 면접에서 바로 반박될 수 있다. RabbitMQ는 소비자 ack, requeue, dead-lettering을 지원하고, 메시지는 ack 전까지 미처리 상태로 남는다. 장기 보존 로그형 재생은 Kafka가 더 강하지만, RabbitMQ가 재처리를 전혀 못 하는 것은 아니다.
  Improvement: 결론은 "우리 요구사항은 임의 시점 replay와 장기 보존 로그가 핵심이라 Kafka가 더 적합"으로 유지하되, RabbitMQ 평가는 "기본 큐 모델만으로 Kafka 같은 offset-reset replay를 제공하지 않으므로 별도 저장소/재발행 체계가 필요" 정도로 낮춰 적는 것이 정확하다. 공식 근거: RabbitMQ Consumer Acknowledgements and Publisher Confirms, Consumer Prefetch.

- Severity: High
  Issue: 문서는 현재 병렬 처리의 동시성 경계를 `platform_account_id`라고 설명하지만, 실제 `producer.py`의 `getPlatformIdGroupList`는 `(platform_id, platform_password)`를 키로 그룹핑한다.
  Impact: 현재 문제 진단과 Kafka 파티션 키 선택 근거가 완전히 같지 않다. 특히 "현재도 platform_account_id 기준으로 순서 처리"라는 설명은 코드 기준으로는 과장이다.
  Improvement: 현재 구조 설명을 "`platform_id + password` 기준 그룹"으로 수정하고, 그 위에 `platform_account_id`가 별도로 누적되는 구조라고 적는 편이 맞다. 그 다음 Kafka 설계에서 왜 `platform_account_id`를 더 엄격한 파티션 키로 올릴지 명시하면 논리가 더 강해진다.

- Severity: Medium
  Issue: `replies.request_status` 상태 전이가 핵심 상태만 담고 있어 현재 코드의 실제 상태 공간을 완전히 반영하지 못한다.
  Impact: 현재 `cmong-be` enum에는 `MARKETING_PENDING(5)`, `MARKETING_COMPLETED(6)`, `MARKETING_FAILED(7)`도 존재한다. 문서만 보면 reply 상태 체계가 더 단순한 것으로 오해될 수 있다.
  Improvement: "리뷰 크롤링/일반 답글 흐름의 핵심 상태만 발췌"라고 명시하거나, 마케팅 전용 상태 5/6/7을 별도 줄로 추가하는 것이 좋다.

- Severity: Medium
  Issue: `cmong-mq`는 RabbitMQ를 쓰지 않는다는 문장은 해당 경로 기준으로는 맞지만, 코드베이스 전체 기준으로는 범위가 좁다.
  Impact: 현재 `cmong-be`에는 실제 RabbitMQ 설정(`Transport.RMQ`, `amqps://...`)과 큐 관련 코드가 존재한다. 면접에서 "그런데 레포에는 RabbitMQ 코드가 있네요?"라는 질문이 나오면 설명이 길어진다.
  Improvement: 문장을 "`cmong-mq`의 리뷰 수집 경로는 RabbitMQ를 사용하지 않는다"로 스코프를 좁혀 쓰면 훨씬 안전하다. 즉, "전체 시스템에 메시징 코드가 전혀 없다"가 아니라 "이 ADR이 다루는 크롤링 경로는 HTTP/subprocess 기반"이라고 한정해 주는 편이 좋다.

- Severity: Medium
  Issue: 워커 수, 플랫폼별 처리 시간, TPS, 전체 시간당 처리량 수치가 현재 저장소만으로는 모두 재현 가능하지 않다.
  Impact: `mqscript.sh`와 `mqscript_hyphen.sh`는 존재하지만, 문서에 적힌 `baemin 30 / yogiyo 10 / cpeats 15 / ...`와 정확한 초당 처리량은 현재 코드만으로 검증되지 않는다. 수치가 근거 없이 보이면 ADR의 신뢰도가 떨어진다.
  Improvement: 각 수치 옆에 "운영 crontab 기준", "CloudWatch/로그 관측치", "대략치", "2026-04-03 기준" 같은 출처 태그를 붙여라. 코드 근거와 운영 관측 근거를 섞지 않는 것이 중요하다.

- Severity: Medium
  Issue: `Python GIL`과 `MySQL max_connections=151 초과 위험` 부분은 현재 문서에서는 사실보다 가설에 가깝다.
  Impact: 현재 워크로드는 외부 API, 브라우저, DB I/O 비중이 커 보여 GIL이 지배 병목이라고 단정하기 어렵다. 또 Pony ORM 풀 설정과 실제 DB 연결 수는 이 문서에서 제시되지 않아 "151 초과 위험"도 추정치에 가깝다.
  Improvement: 이 부분은 "가능성 있는 병목" 또는 "운영 리스크 가설"로 낮춰 표현하라. 확정 사실처럼 쓰려면 실제 CPU 프로파일, DB connection metric, pool 설정 근거가 필요하다.

- Severity: Medium
  Issue: `#386`, `#387`, `#388`, `#373`, `#378` 같은 커밋/이슈 번호는 현재 로컬 `cmong-mq`와 `cmong-be` Git 로그에서 바로 재현되지 않았다.
  Impact: 문서를 읽는 사람이 동일 근거를 따라가 검증하기 어렵다. 포트폴리오 문서에서 "재현 가능한 증거"가 약해진다.
  Improvement: 커밋 SHA, PR 링크, 이슈 URL, 또는 "사내 이슈 번호"라고 명시해라. 최소한 "로컬 공개 저장소에서는 직접 재현되지 않는 운영 이슈 번호"라고 적어두면 혼란이 줄어든다.

- Severity: Low
  Issue: Redis Streams 대안 평가가 너무 짧아 왜 탈락했는지 설득력이 약하다.
  Impact: Redis Streams도 append-only log, consumer group, trimming을 제공하므로, 단순히 "보존 정책 유연성 부족"만으로는 Kafka 대비 탈락 사유가 약하게 보일 수 있다.
  Improvement: Redis 탈락 사유를 "기존 Redis를 캐시/락에도 사용 중이어서 이벤트 영속성과 운영 장애 도메인을 분리하고 싶었다", "장기 replay와 대량 backlog 관리에서 Kafka 운영 모델이 더 맞았다"처럼 시스템 맥락 중심으로 보강하는 편이 좋다. 공식 근거: Redis Streams, XTRIM 문서.

Questions or assumptions:

- `cmong-mq` 실행 구조는 로컬 코드로 확인했다. `FastApi.py`의 `/populate/`는 실제로 `subprocess.run(...)`으로 `producer.py`를 동기 실행한다.
- `mqscript.sh`의 동일 플랫폼 중복 실행 방지 로직은 로컬 코드로 확인했다.
- `consumer.py`는 현재 RabbitMQ 튜토리얼 수준의 단순 예제로 보이며, 문서의 "실서비스 코드가 아니다"라는 설명은 타당하다.
- 반면 운영 crontab의 실제 워커 수, 플랫폼별 평균 처리 시간, Hyphen 커버리지, 과거 incident 번호는 현재 로컬 코드만으로는 전부 검증되지 않았다. 이 부분은 운영 관측치라는 표시가 필요하다.

검토 근거:

- 로컬 코드: `cmong-mq/FastApi.py`, `cmong-mq/producer.py`, `cmong-mq/mqscript.sh`, `cmong-mq/mqscript_hyphen.sh`, `cmong-be/src/consts/enum.ts`, `cmong-be/src/queueManager/config/queue.config.ts`, `cmong-be/src/queueManager/config/queue-microservice-config.ts`
- 공식 문서:
  - Kafka Consumer Configs: https://kafka.apache.org/41/configuration/consumer-configs/
  - RabbitMQ Consumer Acknowledgements and Publisher Confirms: https://www.rabbitmq.com/docs/4.1/confirms
  - RabbitMQ Consumer Prefetch: https://www.rabbitmq.com/docs/consumer-prefetch
  - Redis Streams: https://redis.io/docs/latest/develop/data-types/streams/
  - Redis XTRIM: https://redis.io/docs/latest/commands/xtrim/
