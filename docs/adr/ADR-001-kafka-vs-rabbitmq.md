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

### 운영 중인 시스템 개요

배달 플랫폼 리뷰 관리 SaaS를 운영하고 있다.
사장님들이 배민, 요기요, 쿠팡이츠, 네이버, 땡겨요, 먹깨비 — 6개 플랫폼의 리뷰를
한 곳에서 확인하고, AI가 생성한 답글을 자동/수동으로 등록하는 서비스다.

### 데이터 흐름

```
[cmong-scraper-js]  →  [RabbitMQ]  →  [cmong-mq workers]  →  [DB]  →  [cmong-be API]
 TypeScript + Playwright   메시지큐     Python task workers      MySQL    NestJS
 6개 플랫폼 세션 로그인                  리뷰 수집, AI 답글 생성
 리뷰/주문/메뉴 API 호출                  자동 댓글 등록
```

### DB 핵심 구조

```sql
shops         -- 플랫폼별 매장 (is_active: 0=기본, 1=활성, 2=비활성, deleted_at)
reviews       -- 수집된 리뷰 (rating 1-5, reply1/2/3 AI 추천, blind_status)
replies       -- 등록할 댓글 (request_status 0-10, error_detail, retry_count)
platform_accounts -- 플랫폼 로그인 계정 (request_status: failed 시 해당 계정 전체 정지)
ai_replies    -- AI 생성 답글 풀 (rating_recommend 1-5)
```

replies 테이블의 `request_status`는 10가지 상태를 가진다:
```
0  DEFAULT      → 초기 상태
1  PENDING      → 처리 대기
2  COMPLETED    → 완료
3  COMPLETED_BY_CEO → 사장님 직접 등록
4  FAILED       → 실패
5  MARKETING_PENDING
6  MARKETING_COMPLETED
7  MARKETING_FAILED
8  FAILED_WITHOUT_RETRY → 재시도 없는 실패
9  BATCH_PENDING → 배치 대기
10 AUTO_REPLY_COMPLETED → 자동 댓글 완료
```

### cmong-mq workers가 하는 일

Python + pika(RabbitMQ 클라이언트) 기반. 각 task는 RabbitMQ에서 메시지를 받아 처리:

| Task | 설명 |
|------|------|
| `populate_task.py` (111KB) | 플랫폼별 리뷰 수집 + AI 답글 생성 + 자동 댓글 등록 |
| `order_task.py` (24KB) | 주문 데이터 수집 (배민/요기요/쿠팡이츠, 최대 180일) |
| `menu_crawl_task.py` (46KB) | 메뉴판 데이터 수집 (메뉴명, 가격, 품절 상태) |
| `shop_dashboard_task.py` | 매장 대시보드 데이터 |
| `sync_shop_task.py` (30KB) | 플랫폼-DB 매장 동기화 |
| `blind_review_task.py` | 블라인드 처리 요청 |

---

## 실제 발생한 문제들

### 문제 1: 메시지 처리 중 서비스 재배포 시 데이터 유실 (핵심)

배민 리뷰를 수집하는 `populate_task`가 처리 중일 때 서비스를 재배포하면,
처리 중이던 메시지가 유실되어 해당 매장의 리뷰가 수집되지 않는다.

RabbitMQ의 기본 동작:
```
1. Consumer가 메시지 수신
2. pika auto-ack → 수신 즉시 큐에서 삭제
3. 처리 도중 worker 재시작 → 메시지 소멸
4. 해당 매장 리뷰 미수집 → 사장님 대시보드 빈 화면
```

실제 코드 (cmong-mq/consumer.py):
```python
# 현재: auto-ack 방식 — 수신 즉시 확인 처리
channel.basic_consume(queue="task_queue", on_message_callback=callback)
# callback 내부에서 ch.basic_ack() 를 명시적으로 호출하지만
# 처리 로직 중간에 예외 발생 시 ack 없이 종료되는 케이스 존재
```

**커밋 히스토리에서 확인된 실제 증상 (6106a8d)**:
```
fix: 로그 버퍼 누락으로 인한 baemin 등 플랫폼 로그 잘림 현상 수정
```
로그 버퍼 누락 = 메시지 처리 중 프로세스 비정상 종료 시 로그가 중간에 잘리는 현상.
이 버그의 근본 원인은 메시지 처리와 확인(ack) 사이의 타이밍 문제다.

### 문제 2: 처리 실패한 메시지의 재처리 불가 (구조적 한계)

플랫폼별 로그인 에러 임계값:
```python
# cmong-mq/constants.py
PLATFORM_LOGIN_ERROR_COUNTS = {
    'BAEMIN': 3,
    'YOGIYO': 2,
    'CPEATS': 3,
    'DDANGYO': 3,
    'NAVER': 1,   # 네이버는 1번만 재시도
    'MUKKEBI': 3,
}
```

네이버 로그인이 1회 실패하면 해당 메시지 처리를 포기한다.
나중에 "이 매장의 네이버 리뷰를 다시 수집하고 싶다"고 해도,
RabbitMQ에서는 이미 소비된 메시지를 다시 가져올 방법이 없다.

**실제 영향**: 파싱 로직이 바뀌거나 플랫폼 API 스펙이 변경됐을 때,
과거 데이터를 다시 처리하려면 수동으로 재요청을 만들어야 함.

커밋 기록에서 빈번히 등장하는 패턴:
```
fix: 토큰 없는 경우 처리 로직 수정 (#387)
fix: v2로 응답 양식 변경 (#386)
```
API 응답 스펙이 바뀔 때마다 이전에 파싱 실패한 메시지들을 재처리할 방법이 없어
데이터 누락이 발생한다.

### 문제 3: 동시성 — 같은 플랫폼 계정의 토큰 경합 (커밋 #388)

```
fix: 토큰 값이 덮어씌워질 수 있어 로직 수정 (#388)
fix: 같은 프로세스에서의 race condition 회피 (#373)
```

`populate_task`는 여러 worker가 동시에 실행되며,
같은 플랫폼 계정(platform_account)으로 여러 매장을 처리한다.
Worker A가 계정 X의 세션 토큰을 갱신하는 동시에
Worker B도 같은 계정 X의 토큰을 읽으면 → 덮어쓰기 발생 → 인증 실패.

RabbitMQ에는 이 경합을 방지할 내장 메커니즘이 없다.
(임시 해결: `race condition 회피` 로직을 각 task에 개별 구현)

### 문제 4: 중복 처리로 인한 DB 중복 저장 (커밋 #378)

```
Fix duplicate error (#378)
```

Consumer가 메시지를 처리하고 ack를 보내기 전에 재시작되면,
같은 메시지를 두 번 처리한다. 결과:
- 같은 리뷰 ID로 replies 테이블에 중복 행 생성
- 자동 댓글이 플랫폼에 두 번 등록되는 실제 사고

### 문제 5: soft-delete된 매장 필터 누락 (커밋 #383)

```
fix: soft-delete된 shop은 제외되도록 수정 (#383)
```

Shop 엔티티에는 `deleted_at` 컬럼(soft-delete)이 있다.
하지만 RabbitMQ 메시지에는 매장 ID만 담겨있고,
task worker가 처리 시점에 `deleted_at IS NULL` 조건을 빠뜨리면
이미 삭제된 매장에 대해 크롤링 요청이 발생했다.

### 문제 6: CPEATS Hyphen API 격리 상태 관리 복잡성

```python
# cmong-mq/clients/hyphen_client.py
HYPHEN_SKIP_HOURS = 24  # 24시간 이내 크롤링한 shop 스킵

class HyphenState:
    state: 'QUARANTINED' | 'NORMAL'
    consecutive_fail_count: int
    quarantined_at: datetime
    next_probe_at: datetime  # 12시간 후 재시도
```

CPEATS 매장이 Hyphen API를 통해 수집되는데,
로그인 실패가 반복되면 해당 매장을 격리(QUARANTINE)한다.
격리 상태 체크 → 12시간 대기 → 재시도 프로브 → 복구/재격리 로직이
각 task worker에 흩어져 있어 상태 추적이 어렵다.

---

## 검토한 대안

### Option A: RabbitMQ 유지 (Java 클라이언트로 포팅)

위에서 설명한 문제들을 RabbitMQ + Java로 해결하려면:
- 메시지 유실 방지 → `basicNack` + Dead Letter Exchange 설정
- 재처리 불가 → 해결 방법 없음 (소비된 메시지는 영구 삭제)
- 토큰 경합 → 별도 분산락 구현 필요
- 중복 처리 → Consumer 레벨 멱등성 구현 필요 (RabbitMQ 자체 지원 없음)

**핵심 한계**: RabbitMQ는 메시지를 소비 즉시 삭제하는 큐 모델.
"특정 시점부터 다시 처리"하는 재처리 요구사항을 구조적으로 지원하지 않음.

**장점**:
- 기존 RabbitMQ 운영 경험 그대로 활용
- Exchange/Routing Key 기반 유연한 메시지 라우팅
- 운영 복잡도 낮음
- 단순 RPC 패턴(cmong-mq의 요청-응답)에 적합

**단점**:
- 메시지 소비 후 영구 삭제 → API 스펙 변경 시 재처리 불가
- 파티션 기반 병렬성 없음 → Consumer 수를 늘려도 순서 보장 복잡
- 대규모 팬아웃(fan-out: 같은 이벤트를 여러 서비스가 소비) 구조에서 큐를 여러 개 만들어야 함
- 메시지 재생(replay) 기능 없음

### Option B: Apache Kafka (선택)

**위 문제들을 Kafka로 어떻게 해결하는가**:

| 실제 문제 | Kafka 해결 방식 |
|---------|--------------|
| 재배포 시 메시지 유실 | 오프셋 기반 Manual Commit — ack 전 크래시 시 재시작 후 동일 오프셋부터 재처리 |
| API 스펙 변경 후 재처리 불가 | 메시지 보존 (기본 7일) — 오프셋 리셋으로 원하는 시점부터 재처리 |
| 토큰 경합 | 파티션 키 = platform_account_id — 같은 계정의 메시지는 같은 Consumer가 처리 |
| 중복 처리 | Idempotent Consumer 패턴 + `processed_events` 테이블 |
| soft-delete 필터 누락 | Consumer에서 처리 전 Shop 상태 재확인 (실시간 조회 or Event Sourcing) |
| Hyphen 격리 상태 산재 | Consumer Group 분리 — CPEATS 처리를 독립 서비스로 격리 |

**장점**:
- 메시지 보존 → 재처리 가능
- 파티션 키로 순서 보장 + 경합 방지
- Consumer Group으로 동일 이벤트를 여러 서비스가 독립 소비 가능
  (예: 리뷰 수집 완료 이벤트 → 저장 서비스 + AI 답글 생성 서비스 + 알림 서비스가 각각 소비)
- 높은 처리량 (파티션 확장으로 선형 스케일)

**단점**:
- 운영 복잡도 높음 (KRaft/Zookeeper 필요)
- 단순 RPC 패턴에는 오버스펙
- 파티션 수 = Consumer 최대 병렬 처리 수 (파티션보다 Consumer가 많으면 유휴 발생)
- 전체 순서 보장은 파티션 1개로 제한

### Option C: Redis Streams

**장점**: Redis 하나로 캐시 + 메시지큐 통합, 운영 단순
**단점**: 대용량 처리에서 Kafka 대비 성능 한계, 메시지 보존 정책 유연성 부족

---

## AI와 함께 검토한 내용

**내가 AI에게 물어본 것**:
> "실제 운영 규모(6개 플랫폼, 수십만 매장 단위 크롤링)에서 Kafka의 파티션 키 전략으로
> platform_account_id 기반 순서 보장이 가능한가?
> 단, 한 계정이 수백 개 매장을 가질 경우 파티션 쏠림 문제는?"

**AI 답변 요약**:
> "platform_account_id를 파티션 키로 쓰면 같은 계정의 메시지가 항상 같은 Consumer에서 처리됨.
> 파티션 쏠림은 계정 수가 파티션 수보다 훨씬 많다면 자연스럽게 분산됨.
> 단, 한 계정에 수백 개 매장이 연결된 '대형 계정'이 있다면 해당 파티션에 부하 집중 가능.
> 해결책: platform_account_id + shop_id 복합 키 사용 또는 해시 기반 분산."

**내 판단**:
현재 시스템에서 `platform_account`는 하나의 계정에 다수의 `shops`가 연결되어 있다.
대형 프랜차이즈 계정은 수백 개 매장을 가질 수 있어 쏠림 가능성이 있다.
포트폴리오 프로젝트에서는 `shop_id`를 파티션 키로 사용하여 더 고른 분산을 선택한다.
이 판단의 근거는 ADR-005(Outbox Relay 파티셔닝 전략)에서 상세히 다룬다.

---

## 결정: Kafka 선택

### 선택 근거

1. **재처리 요구사항이 실재한다**:
   플랫폼 API 스펙 변경(#386 `v2로 응답 양식 변경`)이 발생할 때마다
   이전에 파싱 실패한 리뷰를 재처리해야 한다.
   Kafka의 오프셋 리셋으로 이를 구조적으로 해결한다.

2. **파티션 키로 경합 방지**:
   토큰 덮어쓰기 버그(#388)의 근본 원인은 같은 계정을 여러 worker가 동시에 처리하는 것.
   `shop_id`를 파티션 키로 쓰면 같은 shop의 이벤트는 항상 같은 Consumer가 순서대로 처리.
   분산락 없이도 경합 방지 가능.

3. **Consumer Group으로 독립적 팬아웃**:
   리뷰 수집 완료 이벤트를 저장, AI 답글 생성, 알림이 각각 독립적으로 소비.
   RabbitMQ였다면 동일 메시지를 위한 큐를 3개 만들어야 함.

### 이 결정이 틀렸다고 판단할 기준

- 단일 shop에 대한 이벤트 처리 순서 보장이 필요 없어지는 경우 → 파티션 키 전략 재검토
- 메시지 보존 7일이 충분하지 않은 장기 재처리 요구 → 별도 이벤트 저장소 필요
- 운영 팀 규모가 작아 Kafka 운영 부담이 실익보다 큰 경우 → RabbitMQ + 외부 이벤트 저장소 조합 검토

---

## 구현 결정 사항

| 설정 | 값 | 근거 |
|-----|---|-----|
| 파티션 수 | 6 | Consumer 최대 6개 기준 (플랫폼 수 = 6과 일치) |
| Replication Factor | 1 (로컬), 3 (운영 환경 가정) | 로컬 단일 브로커 |
| 파티션 키 | `shop_id` | platform_account_id 쏠림 방지 |
| `enable.auto.commit` | `false` | 처리 완료 후 Manual Commit — 재배포 시 유실 방지 |
| `max.poll.records` | `100` | `처리 시간 × 100 < max.poll.interval.ms(5분)` 기준 |
| `max.poll.interval.ms` | `300,000ms` | 플랫폼 크롤링 최대 소요 시간 5분 이내 보장 |
| Dead Letter Topic | 활성화 | 3회 실패 시 DLT 이동 (기존 `FAILED_WITHOUT_RETRY` 상태와 동일 의미) |

---

## 참고

- cmong-mq git log: 실제 운영 이슈 히스토리
- [Kafka 공식 문서 - Consumer Configuration](https://kafka.apache.org/documentation/#consumerconfigs)
- [카카오페이 기술블로그 - Kafka를 이용한 이벤트 드리븐 아키텍처](https://tech.kakaopay.com)
- cmong-mq/clients/hyphen_client.py: Hyphen 격리 상태 관리 패턴
- cmong-mq/cmongdb.py: DB 엔티티 구조 (Pony ORM 기반)
